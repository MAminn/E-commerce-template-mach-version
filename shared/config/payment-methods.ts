/**
 * Payment method identifiers shared by server and client code.
 *
 * Deliberately env-free so it can be imported from browser bundles — every
 * secret-touching accessor lives in ./payment.ts. The DB enum in
 * shared/database/drizzle/schema.ts (`payment_method`) must list the same
 * values; adding a gateway means adding it here AND writing a migration.
 */

export const ONLINE_PAYMENT_METHODS = ["stripe", "paymob", "fawaterak"] as const;
export type PaymentGateway = (typeof ONLINE_PAYMENT_METHODS)[number];

export const PAYMENT_METHODS = ["cod", ...ONLINE_PAYMENT_METHODS] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** True for any gateway-backed method (everything except COD). */
export function isOnlinePaymentMethod(
  method: string | null | undefined,
): method is PaymentGateway {
  return (
    typeof method === "string" &&
    (ONLINE_PAYMENT_METHODS as readonly string[]).includes(method)
  );
}
