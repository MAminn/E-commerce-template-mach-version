/**
 * Payment Gateway Configuration
 *
 * Auto-detects which payment gateways are available based on environment variables.
 * If no gateway keys are configured, the system falls back to COD-only mode.
 *
 * Supported gateways:
 * - Stripe: Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
 * - Paymob: Set PAYMOB_API_KEY + PAYMOB_INTEGRATION_ID + PAYMOB_HMAC_SECRET
 * - Fawaterak (v3 hosted checkout): Set FAWATERAK_CLIENT_ID +
 *   FAWATERAK_CLIENT_SECRET + FAWATERAK_VENDOR_API_KEY
 */

import {
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHODS,
  isOnlinePaymentMethod,
  type PaymentGateway,
  type PaymentMethod,
} from "./payment-methods";

export {
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHODS,
  isOnlinePaymentMethod,
  type PaymentGateway,
  type PaymentMethod,
};

// ─── Gateway detection ──────────────────────────────────────────────────────

function isNonEmpty(val: string | undefined): boolean {
  return typeof val === "string" && val.trim().length > 0;
}

/** Check if Stripe is configured (requires secret key at minimum) */
export function isStripeConfigured(): boolean {
  return isNonEmpty(process.env.STRIPE_SECRET_KEY);
}

/** Check if Paymob is configured (requires secret key + at least one integration ID) */
export function isPaymobConfigured(): boolean {
  const hasKey =
    isNonEmpty(process.env.PAYMOB_SECRET_KEY) ||
    isNonEmpty(process.env.PAYMOB_API_KEY);
  const hasIntegration =
    isNonEmpty(process.env.PAYMOB_CARD_INTEGRATION_ID) ||
    isNonEmpty(process.env.PAYMOB_WALLET_INTEGRATION_ID) ||
    isNonEmpty(process.env.PAYMOB_INTEGRATION_ID);
  return hasKey && hasIntegration;
}

/**
 * Check if Fawaterak is configured. All three server-side values are required:
 * the OAuth client pair drives every /api/v3 call, and the vendor API key is
 * the only thing that can authenticate an inbound webhook — without it a
 * hosted checkout could be created but never safely confirmed, so the method
 * is not offered at all.
 */
export function isFawaterakConfigured(): boolean {
  return (
    isNonEmpty(process.env.FAWATERAK_CLIENT_ID) &&
    isNonEmpty(process.env.FAWATERAK_CLIENT_SECRET) &&
    isNonEmpty(process.env.FAWATERAK_VENDOR_API_KEY)
  );
}

/** Returns array of all active gateways (empty = COD only) */
export function getActiveGateways(): PaymentGateway[] {
  const gateways: PaymentGateway[] = [];
  if (isStripeConfigured()) gateways.push("stripe");
  if (isPaymobConfigured()) gateways.push("paymob");
  if (isFawaterakConfigured()) gateways.push("fawaterak");
  return gateways;
}

/** Returns all available payment methods (always includes COD) */
export function getAvailablePaymentMethods(): PaymentMethod[] {
  return ["cod", ...getActiveGateways()];
}

/** Whether any online payment gateway is configured */
export function hasOnlinePayment(): boolean {
  return getActiveGateways().length > 0;
}

// ─── Config accessors (server-side only) ────────────────────────────────────

export function getStripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    publicKey: process.env.VITE_STRIPE_PUBLIC_KEY ?? "",
  };
}

export function getPaymobConfig() {
  return {
    // New-format keys (preferred)
    secretKey:
      process.env.PAYMOB_SECRET_KEY ?? process.env.PAYMOB_API_KEY ?? "",
    publicKey: process.env.PAYMOB_PUBLIC_KEY ?? "",
    cardIntegrationId:
      process.env.PAYMOB_CARD_INTEGRATION_ID ??
      process.env.PAYMOB_INTEGRATION_ID ??
      "",
    walletIntegrationId: process.env.PAYMOB_WALLET_INTEGRATION_ID ?? "",
    hmacSecret: process.env.PAYMOB_HMAC_SECRET ?? "",
    baseUrl: process.env.PAYMOB_BASE_URL ?? "https://accept.paymob.com",
    // Legacy aliases kept for any old call-sites
    apiKey:
      process.env.PAYMOB_API_KEY ?? process.env.PAYMOB_SECRET_KEY ?? "",
    integrationId:
      process.env.PAYMOB_CARD_INTEGRATION_ID ??
      process.env.PAYMOB_INTEGRATION_ID ??
      "",
    iframeId: process.env.PAYMOB_IFRAME_ID ?? "",
  };
}

export const FAWATERAK_DEFAULT_BASE_URL = "https://app.fawaterk.com";

/**
 * Fawaterak v3 config. Every value here is a server-side secret or a server
 * URL — none of it may be exposed through VITE_* or the payment.methods query.
 */
export function getFawaterakConfig() {
  const rawBase = process.env.FAWATERAK_BASE_URL;
  const baseUrl = (isNonEmpty(rawBase) ? (rawBase as string) : FAWATERAK_DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  return {
    clientId: process.env.FAWATERAK_CLIENT_ID ?? "",
    clientSecret: process.env.FAWATERAK_CLIENT_SECRET ?? "",
    /** Signs webhook hashes (transactionHashKey / hashKey). Never sent anywhere. */
    vendorApiKey: process.env.FAWATERAK_VENDOR_API_KEY ?? "",
    baseUrl,
  };
}

// ─── Display helpers ────────────────────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cod: "Cash on Delivery",
  stripe: "Credit / Debit Card",
  paymob: "Online Payment",
  fawaterak: "Online Payment",
};

export const PAYMENT_METHOD_DESCRIPTIONS: Record<PaymentMethod, string> = {
  cod: "Pay when your order is delivered to your doorstep",
  stripe: "Pay securely with Visa, Mastercard, or other cards via Stripe",
  paymob: "Pay securely online via Paymob (cards, wallets, installments)",
  fawaterak:
    "Pay securely online — choose card, mobile wallet, Fawry and more on the next step",
};

/** Provider name used to disambiguate when two methods share a label. */
const PAYMENT_METHOD_PROVIDER_NAMES: Record<PaymentMethod, string> = {
  cod: "Cash",
  stripe: "Stripe",
  paymob: "Paymob",
  fawaterak: "Fawaterak",
};

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  description: string;
}

/**
 * Customer-facing options for the given methods. Labels are the plain
 * defaults ("Online Payment") unless two configured methods would otherwise
 * be indistinguishable, in which case each gets its provider appended.
 */
export function getPaymentMethodOptions(
  methods: PaymentMethod[] = getAvailablePaymentMethods(),
): PaymentMethodOption[] {
  const labelCounts = new Map<string, number>();
  for (const m of methods) {
    const label = PAYMENT_METHOD_LABELS[m];
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  return methods.map((id) => {
    const base = PAYMENT_METHOD_LABELS[id];
    const label =
      (labelCounts.get(base) ?? 0) > 1
        ? `${base} (${PAYMENT_METHOD_PROVIDER_NAMES[id]})`
        : base;
    return { id, label, description: PAYMENT_METHOD_DESCRIPTIONS[id] };
  });
}
