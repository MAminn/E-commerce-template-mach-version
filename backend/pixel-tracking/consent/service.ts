import { query } from "#root/shared/database/drizzle/db";
import { trackingConsent } from "#root/shared/database/drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { v7 } from "uuid";
import { ServerError } from "#root/shared/error/server";
import type {
  ConsentCategories,
  ConsentMethodType,
  ConsentState,
} from "#root/shared/types/pixel-tracking";

// ─── Schemas ────────────────────────────────────────────────────────────────

const consentCategorySchema = z.object({
  functional: z.boolean().default(true),
  analytics: z.boolean().default(false),
  marketing: z.boolean().default(false),
});

const consentMethodSchema = z.enum([
  "banner_accept",
  "banner_reject",
  "settings_page",
  "implied",
]);

export const recordConsentSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().uuid().optional(),
  consentGiven: z.boolean(),
  consentCategories: consentCategorySchema,
  consentMethod: consentMethodSchema,
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export const updateConsentSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().uuid().optional(),
  consentCategories: consentCategorySchema,
  consentMethod: consentMethodSchema,
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type RecordConsentInput = z.infer<typeof recordConsentSchema>;
export type UpdateConsentInput = z.infer<typeof updateConsentSchema>;

// ─── Pure helpers ───────────────────────────────────────────────────────────
//
// The cookie/state helpers live in `shared/utils/consent-gate.ts` so the
// browser can import them without dragging this file's database imports into
// the client bundle. They are re-exported here so existing server-side
// callers and tests keep working unchanged.

export {
  CONSENT_COOKIE_NAME,
  getDefaultConsentState,
  buildAcceptAllConsent,
  buildRejectAllConsent,
  isConsentExpired,
  getAllowedPlatforms,
  serializeConsentCookie,
  deserializeConsentCookie,
} from "#root/shared/utils/consent-gate";

/** Consent is valid for 12 months from the date it was given. */
const CONSENT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

// ─── DB Service Functions ───────────────────────────────────────────────────

/**
 * Record a consent decision to the audit log (append-only).
 */
export function recordConsent(input: RecordConsentInput) {
  return Effect.gen(function* () {
    const id = v7();
    const expiresAt = input.consentGiven
      ? new Date(Date.now() + CONSENT_VALIDITY_MS)
      : null;

    const rows = yield* query((db) =>
      db
        .insert(trackingConsent)
        .values({
          id,
          sessionId: input.sessionId,
          userId: input.userId ?? null,
          consentGiven: input.consentGiven,
          consentCategories: input.consentCategories,
          consentMethodType: input.consentMethod,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          expiresAt,
        })
        .returning(),
    );

    if (!rows[0]) {
      return yield* Effect.fail(
        new ServerError({ tag: "ConsentRecordError", message: "Failed to record consent" }),
      );
    }

    return rows[0];
  });
}

/**
 * Update consent via a new entry (consent is an append-only log).
 * Creates a new consent record — previous records are preserved for audit.
 */
export function updateConsent(input: UpdateConsentInput) {
  const consentGiven =
    input.consentCategories.analytics || input.consentCategories.marketing;

  return recordConsent({
    sessionId: input.sessionId,
    userId: input.userId,
    consentGiven,
    consentCategories: input.consentCategories,
    consentMethod: input.consentMethod,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}

/**
 * Get the latest consent record for a given session.
 */
export function getConsentBySession(sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* query((db) =>
      db
        .select()
        .from(trackingConsent)
        .where(eq(trackingConsent.sessionId, sessionId))
        .orderBy(desc(trackingConsent.createdAt))
        .limit(1),
    );

    return rows[0] ?? null;
  });
}

/**
 * Get the latest consent record for a given user.
 */
export function getConsentByUser(userId: string) {
  return Effect.gen(function* () {
    const rows = yield* query((db) =>
      db
        .select()
        .from(trackingConsent)
        .where(eq(trackingConsent.userId, userId))
        .orderBy(desc(trackingConsent.createdAt))
        .limit(1),
    );

    return rows[0] ?? null;
  });
}

/**
 * Get the full consent audit log for a user (all decisions, newest first).
 */
export function getConsentAuditLog(userId: string) {
  return Effect.gen(function* () {
    return yield* query((db) =>
      db
        .select()
        .from(trackingConsent)
        .where(eq(trackingConsent.userId, userId))
        .orderBy(desc(trackingConsent.createdAt)),
    );
  });
}

/**
 * Get the full consent audit log for a session.
 */
export function getConsentAuditLogBySession(sessionId: string) {
  return Effect.gen(function* () {
    return yield* query((db) =>
      db
        .select()
        .from(trackingConsent)
        .where(eq(trackingConsent.sessionId, sessionId))
        .orderBy(desc(trackingConsent.createdAt)),
    );
  });
}
