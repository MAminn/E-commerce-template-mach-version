/**
 * Fawaterak v3 Payment Gateway Service (hosted checkout only)
 *
 * Provider HTTP client + pure verification helpers. Nothing in here touches
 * the database — callers (tRPC router, webhook plugin) own persistence.
 *
 * Flow:
 * 1. POST /oauth/token (client_credentials) → Bearer token, cached in memory
 * 2. POST /api/v3/createTransaction WITHOUT payment_method_id → data.intent_key
 *    + data.url (hosted page where the customer picks card / wallet / Fawry…)
 * 3. Customer is redirected to data.url, then back to our confirmation page
 * 4. POST /api/v3/getTransactionData { intent_key } is the ONLY source of
 *    truth for "paid" — webhooks and redirects merely trigger that lookup.
 *
 * Amounts are decimal major units ("150.00" EGP), not cents. Every comparison
 * goes through toPiasters() so we never compare floats.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { ServerError } from "#root/shared/error/server";
import {
  getFawaterakConfig,
  isFawaterakConfigured,
} from "#root/shared/config/payment";
import { getPublicOrigin } from "#root/shared/config/site-url";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Store currency the hosted checkout is created in and verified against. */
export const FAWATERAK_CURRENCY = "EGP";

/** Webhook paths — `_json` in the path makes Fawaterak deliver application/json. */
export const FAWATERAK_WEBHOOK_PATHS = {
  paid: "/api/webhooks/fawaterak_json",
  failed: "/api/webhooks/fawaterak-failed_json",
  cancel: "/api/webhooks/fawaterak-cancel_json",
} as const;

/** Refresh the cached token this long before Fawaterak says it expires. */
const TOKEN_EXPIRY_SAFETY_MS = 60_000;
/** Used only if the token response omits expires_in. */
const TOKEN_DEFAULT_TTL_SECONDS = 3600;

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * Provider-facing failure. Messages are built from status codes and provider
 * `message` fields only — never from request bodies, headers, or config, so a
 * logged error can never carry a secret or token.
 */
export class FawaterakError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FawaterakError";
    this.status = status;
  }
}

function safeProviderMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const msg = (body as Record<string, unknown>).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 200);
    const err = (body as Record<string, unknown>).error;
    if (typeof err === "string" && err.trim()) return err.trim().slice(0, 200);
  }
  return "";
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// ─── Money ──────────────────────────────────────────────────────────────────

/**
 * Convert a decimal money value ("150.00", 150, "99.5") into integer piasters
 * (15000, 15000, 9950) without floating-point arithmetic. Returns null for
 * anything that is not a plain non-negative decimal with at most two
 * significant fractional digits — callers must treat null as "cannot compare".
 */
export function toPiasters(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fractionRaw = match[2] ?? "";
  // Beyond two decimals only trailing zeros are acceptable ("150.000").
  if (fractionRaw.length > 2 && /[1-9]/.test(fractionRaw.slice(2))) return null;
  const fraction = fractionRaw.slice(0, 2).padEnd(2, "0");
  const piasters = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
  return Number.isSafeInteger(piasters) ? piasters : null;
}

/** Format a DB decimal string / number as the "150.00" shape Fawaterak expects. */
export function formatMajorAmount(value: string | number): string {
  const piasters = toPiasters(value);
  if (piasters === null) {
    throw new FawaterakError(`Invalid money amount: ${String(value)}`);
  }
  const whole = Math.floor(piasters / 100);
  const fraction = piasters % 100;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

// ─── OAuth token cache ──────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** Test hook / manual reset. */
export function clearFawaterakTokenCache(): void {
  tokenCache = null;
}

function requireConfig() {
  if (!isFawaterakConfigured()) {
    throw new FawaterakError("Fawaterak is not configured");
  }
  return getFawaterakConfig();
}

/**
 * Return a valid Bearer token, hitting POST /oauth/token only when the cache
 * is empty, expired (with a safety margin), or `forceRefresh` is set.
 */
export async function getFawaterakAccessToken(options?: {
  forceRefresh?: boolean;
}): Promise<string> {
  const now = Date.now();
  if (!options?.forceRefresh && tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.accessToken;
  }

  const config = requireConfig();
  const response = await fetch(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const body = await readJsonBody(response);
  if (!response.ok) {
    tokenCache = null;
    const detail = safeProviderMessage(body);
    throw new FawaterakError(
      `Fawaterak token request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  const data = (body ?? {}) as Record<string, unknown>;
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    tokenCache = null;
    throw new FawaterakError("Fawaterak token response did not include access_token");
  }
  const expiresInRaw = Number(data.expires_in);
  const expiresIn =
    Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? expiresInRaw
      : TOKEN_DEFAULT_TTL_SECONDS;

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_SAFETY_MS,
  };
  return accessToken;
}

// ─── Authenticated request with single 401 retry ────────────────────────────

async function fawaterakRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const config = requireConfig();

  const send = async (token: string): Promise<Response> =>
    fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  let response = await send(await getFawaterakAccessToken());

  // One fresh token, one retry. A second 401 is a real credential problem.
  if (response.status === 401) {
    clearFawaterakTokenCache();
    response = await send(await getFawaterakAccessToken({ forceRefresh: true }));
  }

  const body = await readJsonBody(response);
  if (!response.ok) {
    const detail = safeProviderMessage(body);
    throw new FawaterakError(
      `Fawaterak ${init.method} ${path} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }
  return body as T;
}

// ─── Create hosted transaction ──────────────────────────────────────────────

export interface CreateFawaterakTransactionInput {
  /** Internal order UUID — the only identity we ever trust back from Fawaterak. */
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress?: string | null;
  /** Persisted DB total (decimal string / number) — the amount the customer pays. */
  total: string | number;
  /** Item names for the hosted page description only; never used for amounts. */
  itemNames?: string[];
}

export interface FawaterakTransactionResult {
  /** data.intent_key — stored as order.paymentSessionId */
  sessionId: string;
  /** data.url — hosted checkout page */
  paymentUrl: string;
  expiresIn: number | null;
}

/** Merchant-visible reference; mirrors the short id shown on the confirmation page. */
export function buildFawaterakOrderReference(orderId: string): string {
  return `ORD-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/**
 * Redirect targets are built from the trusted PUBLIC_ORIGIN — never from a
 * browser-supplied origin. `total`/`email` mirror what the existing checkout
 * puts on the confirmation URL so that page renders identically.
 */
export function buildFawaterakRedirectUrls(order: {
  id: string;
  total: string | number;
  customerEmail: string;
}) {
  const origin = getPublicOrigin();
  const base = new URLSearchParams({
    id: order.id,
    total: formatMajorAmount(order.total),
    email: order.customerEmail,
  });
  const confirmation = (payment: string) => {
    const params = new URLSearchParams(base);
    params.set("payment", payment);
    return `${origin}/order-confirmation?${params.toString()}`;
  };
  return {
    successUrl: confirmation("success"),
    failUrl: confirmation("failed"),
    pendingUrl: confirmation("pending"),
    // Hosted-page "back" — same landing the existing gateways use for cancel,
    // where the customer can retry or contact support with the order kept.
    backUrl: confirmation("cancelled"),
    webhookUrl: `${origin}${FAWATERAK_WEBHOOK_PATHS.paid}`,
  };
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Customer";
  const lastName = parts.slice(1).join(" ") || firstName;
  return { firstName, lastName };
}

/**
 * Build the createTransaction body. Exported so tests can assert the exact
 * request shape without a network layer.
 *
 * Cart representation: one line "Order ORD-XXXXXXXX" × 1 at the persisted DB
 * total. The v3 request has no shipping field and models tax/discount only as
 * percentage/literal adjustments applied by Fawaterak, so real per-item lines
 * (stored at list price, before promo/discount/shipping) could never sum to
 * what the customer actually owes. A single line keeps cartTotal, the item
 * sum, and the DB total identical by construction.
 */
export function buildFawaterakTransactionPayload(
  input: CreateFawaterakTransactionInput,
): Record<string, unknown> {
  const amount = formatMajorAmount(input.total);
  const reference = buildFawaterakOrderReference(input.orderId);
  const { firstName, lastName } = splitName(input.customerName);
  const urls = buildFawaterakRedirectUrls({
    id: input.orderId,
    total: input.total,
    customerEmail: input.customerEmail,
  });

  const description = (input.itemNames ?? [])
    .filter((n) => typeof n === "string" && n.trim())
    .join(", ")
    .slice(0, 120);

  const customer: Record<string, unknown> = {
    first_name: firstName,
    last_name: lastName,
    customer_unique_id: input.orderId,
  };
  if (input.customerEmail?.trim()) customer.email = input.customerEmail.trim();
  if (input.customerPhone?.trim()) customer.phone = input.customerPhone.trim();
  if (input.shippingAddress?.trim()) {
    customer.address = input.shippingAddress.trim().slice(0, 250);
  }

  // Hosted mode: intentionally NO payment_method_id — Fawaterak's page owns
  // the method picker (card / wallet / Fawry / …).
  return {
    cartTotal: amount,
    currency: FAWATERAK_CURRENCY,
    customer,
    cartItems: [
      {
        name: description ? `Order ${reference} — ${description}` : `Order ${reference}`,
        price: amount,
        quantity: 1,
      },
    ],
    pay_load: { orderId: input.orderId },
    tr_number: reference,
    redirectionUrls: urls,
    sendEmail: false,
    sendSMS: false,
    lang: "en",
  };
}

interface CreateTransactionResponse {
  status?: string;
  message?: string;
  data?: {
    intent_key?: string;
    url?: string;
    short_url?: string;
    expires_in?: number;
    payment_data?: unknown;
  };
}

/** Raw provider call (no DB). Prefer the Effect wrapper from tRPC code. */
export async function createFawaterakTransactionRequest(
  input: CreateFawaterakTransactionInput,
): Promise<FawaterakTransactionResult> {
  const payload = buildFawaterakTransactionPayload(input);
  const response = await fawaterakRequest<CreateTransactionResponse>(
    "/api/v3/createTransaction",
    { method: "POST", body: payload },
  );

  const data = response?.data;
  const intentKey = data?.intent_key;
  const url = data?.url ?? data?.short_url;
  if (response?.status !== "success" || typeof intentKey !== "string" || !intentKey) {
    throw new FawaterakError("Fawaterak createTransaction returned no intent_key");
  }
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
    throw new FawaterakError("Fawaterak createTransaction returned no hosted checkout url");
  }

  return {
    sessionId: intentKey,
    paymentUrl: url,
    expiresIn: typeof data?.expires_in === "number" ? data.expires_in : null,
  };
}

export const createFawaterakTransaction = (input: CreateFawaterakTransactionInput) =>
  Effect.tryPromise({
    try: () => createFawaterakTransactionRequest(input),
    catch: (error) =>
      new ServerError({
        tag: "PaymentError",
        message: `Failed to create Fawaterak transaction: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        statusCode: 502,
        clientMessage: "Failed to create payment session",
      }),
  });

// ─── Retrieve transaction (authoritative) ───────────────────────────────────

export interface FawaterakTransactionData {
  intent_key?: unknown;
  transaction_id?: unknown;
  paid?: unknown;
  status_text?: unknown;
  total?: unknown;
  currency?: unknown;
  payment_method?: unknown;
  pay_load?: unknown;
  paid_at?: unknown;
  transaction_created_at?: unknown;
  due_date?: unknown;
  transaction_link?: unknown;
  transaction_history?: unknown;
  customer_email?: unknown;
  commission?: unknown;
}

interface GetTransactionDataResponse {
  status?: string;
  message?: string;
  data?: FawaterakTransactionData;
}

/** Raw provider call (no DB). */
export async function fetchFawaterakTransactionData(
  intentKey: string,
): Promise<FawaterakTransactionData> {
  if (!intentKey || typeof intentKey !== "string") {
    throw new FawaterakError("intent_key is required");
  }
  const response = await fawaterakRequest<GetTransactionDataResponse>(
    "/api/v3/getTransactionData",
    { method: "POST", body: { intent_key: intentKey } },
  );
  if (response?.status !== "success" || !response.data || typeof response.data !== "object") {
    throw new FawaterakError("Fawaterak getTransactionData returned no data");
  }
  return response.data;
}

export const getFawaterakTransactionData = (intentKey: string) =>
  Effect.tryPromise({
    try: () => fetchFawaterakTransactionData(intentKey),
    catch: (error) =>
      new ServerError({
        tag: "PaymentError",
        message: `Failed to verify Fawaterak payment: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        statusCode: 502,
        clientMessage: "Failed to verify payment status",
      }),
  });

// ─── pay_load parsing ───────────────────────────────────────────────────────

/**
 * pay_load comes back as an object (getTransactionData), a JSON string
 * (webhooks) or null. Accept only a plain object with a non-empty string
 * `orderId`; anything else is treated as "no identity" and fails verification.
 */
export function parseFawaterakPayLoad(raw: unknown): { orderId: string } | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const orderId = (value as Record<string, unknown>).orderId;
  if (typeof orderId !== "string" || !orderId.trim()) return null;
  return { orderId: orderId.trim() };
}

// ─── Order ↔ provider verification ──────────────────────────────────────────

export interface FawaterakOrderSnapshot {
  id: string;
  paymentSessionId: string | null;
  total: string | number;
}

export type FawaterakVerification =
  | { ok: true; transactionId: string; paidAt: string | null }
  | { ok: false; reason: string; paid: boolean };

function readPaidFlag(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

function readTransactionId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number.parseInt(value.trim(), 10);
    return n > 0 ? String(n) : null;
  }
  return null;
}

/**
 * The single gate before an order may be marked paid. Every check must pass:
 * provider says paid, intent matches our session, pay_load names our order,
 * amount matches the DB total to the piaster, currency is EGP, and a real
 * (non-zero) transaction_id exists.
 */
export function verifyFawaterakPaidTransaction(
  order: FawaterakOrderSnapshot,
  data: FawaterakTransactionData,
  expectedCurrency: string = FAWATERAK_CURRENCY,
): FawaterakVerification {
  const paid = readPaidFlag(data.paid);
  if (!paid) {
    return { ok: false, paid: false, reason: "provider reports transaction not paid" };
  }

  if (!order.paymentSessionId || data.intent_key !== order.paymentSessionId) {
    return { ok: false, paid, reason: "intent_key does not match order payment session" };
  }

  const payLoad = parseFawaterakPayLoad(data.pay_load);
  if (!payLoad) {
    return { ok: false, paid, reason: "pay_load missing or malformed" };
  }
  if (payLoad.orderId !== order.id) {
    return { ok: false, paid, reason: "pay_load orderId does not match order" };
  }

  const providerPiasters = toPiasters(data.total as string | number | null | undefined);
  const orderPiasters = toPiasters(order.total);
  if (providerPiasters === null || orderPiasters === null) {
    return { ok: false, paid, reason: "amount could not be parsed" };
  }
  if (providerPiasters !== orderPiasters) {
    return {
      ok: false,
      paid,
      reason: `amount mismatch (provider ${providerPiasters} vs order ${orderPiasters} piasters)`,
    };
  }

  const currency =
    typeof data.currency === "string" ? data.currency.trim().toUpperCase() : "";
  if (currency !== expectedCurrency.toUpperCase()) {
    return { ok: false, paid, reason: `currency mismatch (${currency || "none"})` };
  }

  const transactionId = readTransactionId(data.transaction_id);
  if (!transactionId) {
    return { ok: false, paid, reason: "transaction_id missing or zero" };
  }

  return {
    ok: true,
    transactionId,
    paidAt: typeof data.paid_at === "string" ? data.paid_at : null,
  };
}

// ─── Webhook signature helpers ──────────────────────────────────────────────

export function computeFawaterakHash(stringToSign: string, secret: string): string {
  return createHmac("sha256", secret).update(stringToSign, "utf8").digest("hex");
}

/**
 * Constant-time hex comparison. A length mismatch (or non-hex input) is
 * simply `false` — never an exception, never a plain `===` fallback.
 */
export function safeEqualHex(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const a = received.trim().toLowerCase();
  const b = expected.toLowerCase();
  if (!/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function asSignableString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** `TransactionId=…&TransactionKey=…&PaymentMethod=…` (paid, pending, failed). */
export function buildFawaterakTransactionStringToSign(fields: {
  transaction_id: unknown;
  transaction_key: unknown;
  payment_method: unknown;
}): string | null {
  const id = asSignableString(fields.transaction_id);
  const key = asSignableString(fields.transaction_key);
  const method = asSignableString(fields.payment_method);
  if (id === null || key === null || method === null) return null;
  return `TransactionId=${id}&TransactionKey=${key}&PaymentMethod=${method}`;
}

/** `referenceId=…&PaymentMethod=…` (cancel / expired). */
export function buildFawaterakCancelStringToSign(fields: {
  referenceId: unknown;
  paymentMethod: unknown;
}): string | null {
  const ref = asSignableString(fields.referenceId);
  const method = asSignableString(fields.paymentMethod);
  if (ref === null || method === null) return null;
  return `referenceId=${ref}&PaymentMethod=${method}`;
}

function verifyWithVendorKey(stringToSign: string | null, received: unknown): boolean {
  if (stringToSign === null) return false;
  const { vendorApiKey } = getFawaterakConfig();
  if (!vendorApiKey) return false;
  return safeEqualHex(received, computeFawaterakHash(stringToSign, vendorApiKey));
}

/** Paid / pending webhook: signature lives in `transactionHashKey`. */
export function verifyFawaterakPaidWebhookHash(payload: {
  transaction_id: unknown;
  transaction_key: unknown;
  payment_method: unknown;
  transactionHashKey?: unknown;
}): boolean {
  return verifyWithVendorKey(
    buildFawaterakTransactionStringToSign(payload),
    payload.transactionHashKey,
  );
}

/** Failed webhook: same string, signature lives in `hashKey`. */
export function verifyFawaterakFailedWebhookHash(payload: {
  transaction_id: unknown;
  transaction_key: unknown;
  payment_method: unknown;
  hashKey?: unknown;
}): boolean {
  return verifyWithVendorKey(
    buildFawaterakTransactionStringToSign(payload),
    payload.hashKey,
  );
}

/** Cancel / expired webhook: `referenceId` + `paymentMethod`, signature in `hashKey`. */
export function verifyFawaterakCancelWebhookHash(payload: {
  referenceId: unknown;
  paymentMethod: unknown;
  hashKey?: unknown;
}): boolean {
  return verifyWithVendorKey(buildFawaterakCancelStringToSign(payload), payload.hashKey);
}
