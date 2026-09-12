/**
 * Shared-secret verification for the Bosta webhook.
 *
 * Bosta's dashboard lets a business attach one custom header (name + value)
 * to webhook calls; there is no HMAC/signature scheme in the current docs.
 * We configure header `Authorization` with BOSTA_WEBHOOK_SECRET as the value
 * and accept it either raw or as `Bearer <secret>`.
 */
import { timingSafeEqual } from "node:crypto";

export function getBostaWebhookSecret(): string | null {
  const s = process.env.BOSTA_WEBHOOK_SECRET?.trim();
  return s ? s : null;
}

/** `Authorization: Bearer x` → `x`; anything else is returned trimmed. */
export function extractWebhookToken(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  const value = (raw ?? "").trim();
  return /^bearer\s+/i.test(value) ? value.replace(/^bearer\s+/i, "").trim() : value;
}

/** Constant-time string comparison that is also safe for unequal lengths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length mismatches don't return "early".
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function verifyBostaWebhookSecret(
  header: string | string[] | undefined,
  expectedSecret: string,
): boolean {
  const token = extractWebhookToken(header);
  if (!token || !expectedSecret) return false;
  return safeEqual(token, expectedSecret);
}

/**
 * Optional source-IP allowlist (OFF by default). Bosta publishes its outbound
 * IPs at https://docs.bosta.co/docs/how-to/whitelisting; set
 * BOSTA_WEBHOOK_ALLOWED_IPS="34.89.199.241,35.246.223.19" to enforce it.
 */
export function getBostaWebhookAllowedIps(): string[] {
  return (process.env.BOSTA_WEBHOOK_ALLOWED_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isIpAllowed(ip: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!ip) return false;
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return allowed.includes(normalized);
}
