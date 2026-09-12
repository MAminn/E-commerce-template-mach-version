/**
 * Payment Gateway tRPC Router
 *
 * Provides:
 * - paymentMethods: Public query returning available payment methods
 * - createSession: Protected mutation to create a payment session for an order
 * - verifyPayment: Protected mutation to check payment status
 */

import { z } from "zod";
import { Effect, Either } from "effect";
import { t, publicProcedure, provideDatabase } from "#root/shared/trpc/server";
import {
  runBackendEffect,
  serializeBackendEffectResult,
} from "#root/shared/backend/effect";
import {
  getAvailablePaymentMethods,
  getPaymentMethodOptions,
  isStripeConfigured,
  isPaymobConfigured,
  isFawaterakConfigured,
  ONLINE_PAYMENT_METHODS,
} from "#root/shared/config/payment";
import { query } from "#root/shared/database/drizzle/db";
import { order } from "#root/shared/database/drizzle/schema";
import { eq } from "drizzle-orm";
import { createStripeCheckoutSession, getStripeSession } from "./stripe-service";
import { createPaymobPaymentSession, verifyPaymobIntentionPayment } from "./paymob-service";
import {
  createFawaterakTransaction,
  getFawaterakTransactionData,
  verifyFawaterakPaidTransaction,
} from "./fawaterak-service";
import { applyOnlinePaymentUpdate } from "./confirm-online-payment";
import { ServerError } from "#root/shared/error/server";

// ─── Payment Methods Query ──────────────────────────────────────────────────

const paymentMethodsProcedure = publicProcedure.query(async () => {
  const methods = getAvailablePaymentMethods();
  return {
    // Labels/descriptions only — never gateway config or secrets.
    methods: getPaymentMethodOptions(methods),
    hasOnlinePayment: methods.length > 1,
    stripePublicKey: isStripeConfigured()
      ? (process.env.VITE_STRIPE_PUBLIC_KEY ?? "")
      : null,
  };
});

// ─── Create Payment Session ─────────────────────────────────────────────────

const createPaymentSessionSchema = z.object({
  orderId: z.string().uuid(),
  paymentMethod: z.enum(ONLINE_PAYMENT_METHODS),
  // Used by Stripe/Paymob. Fawaterak ignores them and builds its redirect
  // targets from the trusted PUBLIC_ORIGIN server-side.
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// Public — guests who placed an order need to create payment sessions too
const createPaymentSessionProcedure = publicProcedure
  .input(createPaymentSessionSchema)
  .mutation(async ({ ctx, input }) => {
    return await runBackendEffect(
      Effect.gen(function* () {
        // Fetch the order
        const orderData = yield* query(async (db) => {
          const [o] = await db
            .select()
            .from(order)
            .where(eq(order.id, input.orderId))
            .limit(1)
            .execute();
          return o;
        });

        if (!orderData) {
          return yield* Effect.fail(
            new ServerError({
              tag: "NotFound",
              message: "Order not found",
              statusCode: 404,
              clientMessage: "Order not found",
            }),
          );
        }

        // Don't allow creating payment for already paid orders
        if (orderData.paymentStatus === "paid") {
          return yield* Effect.fail(
            new ServerError({
              tag: "BadRequest",
              message: "This order is already paid",
              statusCode: 400,
              clientMessage: "This order is already paid",
            }),
          );
        }

        const totalInCents = Math.round(Number.parseFloat(orderData.total) * 100);
        const shippingInCents = Math.round(Number.parseFloat(orderData.shipping) * 100);
        const taxInCents = Math.round(Number.parseFloat(orderData.tax) * 100);
        const discountInCents = orderData.discount
          ? Math.round(Number.parseFloat(orderData.discount) * 100)
          : 0;
        const currency = process.env.VITE_CURRENCY || "EGP";

        // Fetch order items for line items
        const items = yield* query(async (db) => {
          const { orderItem: orderItemTable } = await import("#root/shared/database/drizzle/schema");
          const rows = await db
            .select({
              name: orderItemTable.name,
              quantity: orderItemTable.quantity,
              price: orderItemTable.price,
            })
            .from(orderItemTable)
            .where(eq(orderItemTable.orderId, input.orderId))
            .execute();
          return rows;
        });

        const lineItems = items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          priceInCents: Math.round(Number.parseFloat(item.price) * 100),
        }));

        let paymentUrl: string;
        let sessionId: string;

        if (input.paymentMethod === "stripe") {
          if (!isStripeConfigured()) {
            return yield* Effect.fail(
              new ServerError({
                tag: "BadRequest",
                message: "Stripe is not configured",
                statusCode: 400,
                clientMessage: "Stripe payment is not available",
              }),
            );
          }

          const result = yield* createStripeCheckoutSession({
            orderId: input.orderId,
            customerEmail: orderData.customerEmail,
            customerName: orderData.customerName,
            items: lineItems,
            totalInCents,
            currency,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
            shippingInCents,
            taxInCents,
            discountInCents,
          });

          paymentUrl = result.checkoutUrl;
          sessionId = result.sessionId;
        } else if (input.paymentMethod === "paymob") {
          if (!isPaymobConfigured()) {
            return yield* Effect.fail(
              new ServerError({
                tag: "BadRequest",
                message: "Paymob is not configured",
                statusCode: 400,
                clientMessage: "Paymob payment is not available",
              }),
            );
          }

          const result = yield* createPaymobPaymentSession({
            orderId: input.orderId,
            customerEmail: orderData.customerEmail,
            customerName: orderData.customerName,
            customerPhone: orderData.customerPhone,
            items: lineItems,
            totalInCents,
            currency,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
          });

          paymentUrl = result.paymentUrl;
          sessionId = result.sessionId;
        } else if (input.paymentMethod === "fawaterak") {
          if (!isFawaterakConfigured()) {
            return yield* Effect.fail(
              new ServerError({
                tag: "BadRequest",
                message: "Fawaterak is not configured",
                statusCode: 400,
                clientMessage: "Online payment is not available",
              }),
            );
          }

          // Hosted checkout: amount, customer and reference all come from the
          // persisted order row — the browser only chose the method.
          const result = yield* createFawaterakTransaction({
            orderId: input.orderId,
            customerName: orderData.customerName,
            customerEmail: orderData.customerEmail,
            customerPhone: orderData.customerPhone,
            shippingAddress: orderData.shippingAddress,
            total: orderData.total,
            itemNames: items.map((item) => item.name),
          });

          paymentUrl = result.paymentUrl;
          sessionId = result.sessionId; // intent_key
        } else {
          return yield* Effect.fail(
            new ServerError({
              tag: "BadRequest",
              message: `Unsupported payment method: ${input.paymentMethod}`,
              statusCode: 400,
              clientMessage: "Unsupported payment method",
            }),
          );
        }

        // Update order with payment session info
        yield* query(async (db) => {
          await db
            .update(order)
            .set({
              paymentMethod: input.paymentMethod,
              paymentStatus: "pending",
              paymentSessionId: sessionId,
              updatedAt: new Date(),
            })
            .where(eq(order.id, input.orderId))
            .execute();
        });

        return {
          paymentUrl,
          sessionId,
        };
      }).pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  });

// ─── Verify Payment Status ──────────────────────────────────────────────────

const verifyPaymentSchema = z.object({
  orderId: z.string().uuid(),
});

// Public — guests need to verify their payment status too
const verifyPaymentProcedure = publicProcedure
  .input(verifyPaymentSchema)
  .query(async ({ ctx, input }) => {
    return await runBackendEffect(
      Effect.gen(function* () {
        const orderData = yield* query(async (db) => {
          const [o] = await db
            .select({
              id: order.id,
              paymentMethod: order.paymentMethod,
              paymentStatus: order.paymentStatus,
              paymentSessionId: order.paymentSessionId,
              paymentTransactionId: order.paymentTransactionId,
              status: order.status,
              total: order.total,
            })
            .from(order)
            .where(eq(order.id, input.orderId))
            .limit(1)
            .execute();
          return o;
        });

        if (!orderData) {
          return yield* Effect.fail(
            new ServerError({ tag: "NotFound", message: "Order not found", statusCode: 404, clientMessage: "Order not found" }),
          );
        }

        // For Stripe, we can also check the session status directly
        if (
          orderData.paymentMethod === "stripe" &&
          orderData.paymentSessionId &&
          orderData.paymentStatus === "pending"
        ) {
          try {
            const session = yield* getStripeSession(orderData.paymentSessionId);
            if (session.payment_status === "paid") {
              yield* query(async (db) => {
                await applyOnlinePaymentUpdate(db, input.orderId, {
                  paymentStatus: "paid",
                  transactionId: session.payment_intent as string,
                  gatewayData: session,
                });
              });
              return {
                ...orderData,
                paymentStatus: "paid" as const,
                status: "processing" as const,
              };
            }
          } catch {
            // If Stripe check fails, return current DB state
          }
        }

        // For Fawaterak, ask the provider directly; the redirect/query string
        // is never trusted. Only a fully verified match flips the order.
        if (
          orderData.paymentMethod === "fawaterak" &&
          orderData.paymentSessionId &&
          orderData.paymentStatus === "pending"
        ) {
          // Effect failures don't surface as JS exceptions inside gen, so a
          // provider outage is captured with `either` and simply leaves the
          // DB state untouched for the next poll.
          const lookup = yield* Effect.either(
            getFawaterakTransactionData(orderData.paymentSessionId),
          );
          if (Either.isRight(lookup)) {
            const providerData = lookup.right;
            const verification = verifyFawaterakPaidTransaction(
              {
                id: orderData.id,
                paymentSessionId: orderData.paymentSessionId,
                total: orderData.total,
              },
              providerData,
            );
            if (verification.ok) {
              yield* query(async (db) => {
                await applyOnlinePaymentUpdate(db, input.orderId, {
                  paymentStatus: "paid",
                  transactionId: verification.transactionId,
                  gatewayData: providerData,
                });
              });
              return {
                ...orderData,
                paymentStatus: "paid" as const,
                status: "processing" as const,
              };
            }
          }
        }

        // For Paymob, poll the intention when the webhook hasn't landed yet
        if (
          orderData.paymentMethod === "paymob" &&
          orderData.paymentSessionId &&
          orderData.paymentStatus === "pending"
        ) {
          try {
            const verification = yield* verifyPaymobIntentionPayment(
              orderData.paymentSessionId,
            );
            if (verification.paid) {
              const transactionId =
                verification.data.id?.toString() ??
                orderData.paymentTransactionId;
              yield* query(async (db) => {
                await applyOnlinePaymentUpdate(db, input.orderId, {
                  paymentStatus: "paid",
                  transactionId,
                  gatewayData: verification.data,
                });
              });
              return {
                ...orderData,
                paymentStatus: "paid" as const,
                status: "processing" as const,
              };
            }
          } catch {
            // If Paymob check fails, return current DB state
          }
        }

        return orderData;
      }).pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  });

// ─── Router ─────────────────────────────────────────────────────────────────

export const paymentRouter = t.router({
  methods: paymentMethodsProcedure,
  createSession: createPaymentSessionProcedure,
  verify: verifyPaymentProcedure,
});
