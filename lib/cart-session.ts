const SESSION_TOKEN_KEY = "cart-session-token";

/**
 * Anonymous per-browser identifier used to correlate a localStorage cart
 * with its server-side capture row (captured_cart), independent of login —
 * most abandoned carts belong to visitors who never create an account.
 * Persisted in localStorage (not a cookie): only ever read/written from the
 * browser via tRPC calls, no SSR or server-side access needed.
 */
export function getCartSessionToken(): string {
  if (typeof window === "undefined") return "";
  let token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) {
    token = generateSessionToken();
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  }
  return token;
}

/**
 * `crypto.randomUUID()` is exposed only in secure contexts (HTTPS, or
 * localhost), so on a plain-HTTP host — such as the temporary staging
 * domain — it is simply absent and calling it throws
 * "crypto.randomUUID is not a function", which used to surface as a
 * checkout error after the order had already been created.
 * `crypto.getRandomValues()` carries no secure-context restriction, so
 * derive an RFC 4122 v4 UUID from it whenever `randomUUID` is missing.
 */
function generateSessionToken(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    // Last resort only: no Web Crypto at all. The token is an opaque
    // correlation id (never a secret / credential), so a non-crypto
    // source is preferable to throwing mid-checkout.
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
