/**
 * Shared HTTP plumbing for the server-side pixel adapters.
 *
 * Two rules everything here exists to enforce:
 *
 *  1. An access token must never reach a log, a database row, or the admin UI.
 *  2. A response body is a diagnostic, not a receipt. It gets truncated and
 *     scrubbed before it is stored, and it is never treated as proof that a
 *     platform accepted anything.
 */

/** Longest response excerpt kept for diagnostics. */
export const MAX_STORED_BODY_LENGTH = 2000;

/** Default per-attempt HTTP timeout. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Default number of attempts (1 initial + retries) for transient failures. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Base delay for exponential backoff. */
export const DEFAULT_BASE_DELAY_MS = 500;

const TOKEN_PATTERNS: RegExp[] = [
  // "access_token":"…", access_token=…, Access-Token: …
  /("?access[_-]?token"?\s*[:=]\s*"?)([^"&,\s}]+)/gi,
  /(Bearer\s+)([A-Za-z0-9._\-|]+)/g,
];

/**
 * Remove anything that looks like a credential from a string bound for a log
 * or the database. Deliberately blunt: over-redacting a diagnostic costs
 * nothing, leaking a CAPI token costs an ad account.
 */
export function redactSecrets(input: string): string {
  let output = input;
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, (_match, prefix: string) => {
      return `${prefix}[REDACTED]`;
    });
  }
  return output;
}

/** Truncate and redact a response body for storage. */
export function sanitizeResponseBody(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  const redacted = redactSecrets(body);
  return redacted.length > MAX_STORED_BODY_LENGTH
    ? `${redacted.slice(0, MAX_STORED_BODY_LENGTH)}…[truncated]`
    : redacted;
}

/**
 * Whether an HTTP status is worth retrying.
 *
 * 429 and 5xx are transient. Every other 4xx is a request the platform will
 * reject identically every time — retrying it just delays the error and
 * triples the load.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

/** Whether a thrown fetch error is worth retrying (network/timeout). */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  // Undici/node-fetch network failures surface as TypeError("fetch failed").
  return err instanceof TypeError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HttpAttemptResult {
  status?: number;
  body?: string;
  /** Set when the attempt never produced a response. */
  networkError?: string;
  attempts: number;
  retryable: boolean;
}

export interface PostJsonOptions {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * POST JSON with a bounded timeout and bounded retries on transient failures.
 *
 * Returns the last attempt's status/body; interpreting them is the caller's
 * job, because "HTTP 200" means different things to Meta and TikTok.
 */
export async function postJsonWithRetry(
  options: PostJsonOptions,
): Promise<HttpAttemptResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const doFetch = options.fetchImpl ?? fetch;

  let lastStatus: number | undefined;
  let lastBody: string | undefined;
  let lastNetworkError: string | undefined;
  let retryable = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await doFetch(options.url, {
        method: "POST",
        headers: options.headers,
        body: options.body,
        ...(controller ? { signal: controller.signal } : {}),
      });

      lastStatus = response.status;
      lastNetworkError = undefined;
      try {
        lastBody = await response.text();
      } catch {
        lastBody = undefined;
      }

      retryable = isRetryableStatus(response.status);
      if (!retryable) {
        return { status: lastStatus, body: lastBody, attempts: attempt, retryable: false };
      }
    } catch (err) {
      lastStatus = undefined;
      lastBody = undefined;
      lastNetworkError =
        err instanceof Error && err.name === "AbortError"
          ? `Request timed out after ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      retryable = isRetryableError(err);
      if (!retryable) {
        return {
          networkError: lastNetworkError,
          attempts: attempt,
          retryable: false,
        };
      }
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    } else {
      return {
        ...(lastStatus !== undefined ? { status: lastStatus } : {}),
        ...(lastBody !== undefined ? { body: lastBody } : {}),
        ...(lastNetworkError ? { networkError: lastNetworkError } : {}),
        attempts: attempt,
        retryable: true,
      };
    }
  }

  /* c8 ignore next */
  return { attempts: maxAttempts, retryable };
}

/** Parse a response body as JSON, returning undefined when it isn't JSON. */
export function parseJsonBody(
  body: string | undefined,
): Record<string, unknown> | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
