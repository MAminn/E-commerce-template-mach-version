/**
 * Minimal HTTP client for the Bosta business API.
 *
 * Source of truth: https://docs.bosta.co (API reference `api.yaml`, v2.0.0).
 *
 *   Base URL : https://app.bosta.co/api/v2
 *   Auth     : `Authorization: <API_KEY>` — NO "Bearer" prefix for API keys.
 *
 * Feature-flagged: everything in the Bosta integration is a no-op unless
 * SYN_BOSTA_KEY is set, so deployments without the key are unaffected.
 */

export const BOSTA_API_BASE = "https://app.bosta.co/api/v2";

export function getBostaApiKey(): string | null {
  const key = process.env.SYN_BOSTA_KEY?.trim();
  return key ? key : null;
}

export function isBostaEnabled(): boolean {
  return !!getBostaApiKey();
}

/** Bosta's standard envelope: `{ success, message, data, errorCode? }`. */
export interface BostaEnvelope<T = unknown> {
  success?: boolean;
  message?: string | string[];
  errorCode?: string | number;
  data?: T;
}

export class BostaApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: string | number | undefined;
  readonly body: unknown;

  constructor(message: string, opts: { statusCode: number; errorCode?: string | number; body?: unknown }) {
    super(`[Bosta] ${message}`);
    this.name = "BostaApiError";
    this.statusCode = opts.statusCode;
    this.errorCode = opts.errorCode;
    this.body = opts.body;
  }

  /** 401/403 — typically an API key without the permission the endpoint needs. */
  get isPermissionError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

function extractMessage(body: Record<string, unknown>, status: number): string {
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  if (Array.isArray(body.message)) return (body.message as unknown[]).map(String).join(", ");
  if (typeof body.error === "string") return body.error;
  if (typeof body.msg === "string") return body.msg;
  return `Bosta API error ${status}`;
}

/**
 * Perform an authenticated Bosta request and unwrap the `data` envelope.
 * Throws {@link BostaApiError} on transport/HTTP/`success:false` failures.
 */
export async function bostaFetch<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = getBostaApiKey();
  if (!apiKey) {
    throw new BostaApiError("SYN_BOSTA_KEY is not configured", { statusCode: 503 });
  }

  const res = await fetch(`${BOSTA_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const envelope = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  if (!res.ok || envelope.success === false) {
    const message = extractMessage(envelope, res.status);
    console.error(`[Bosta] ${method} ${path} failed (${res.status}):`, JSON.stringify(parsed));
    throw new BostaApiError(message, {
      statusCode: res.status,
      errorCode: envelope.errorCode as string | number | undefined,
      body: parsed,
    });
  }

  if (envelope.data !== undefined && envelope.data !== null && typeof envelope.data === "object") {
    return envelope.data as T;
  }
  return envelope as unknown as T;
}
