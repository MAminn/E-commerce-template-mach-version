import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 0058 adds the payment_attempt table (payment-attempt-first online checkout)
 * and order.fulfillment_hold / fulfillment_hold_note. What matters is how the
 * boot-time runner in shared/database/auto-migrate.ts executes it (see
 * migration-0054.test.ts for the runner's rules). Applying it to a real
 * database was verified separately: a disposable Postgres restored from
 * mach-local.dump logged `✅ Applied: 0058_payment_attempt.sql`, and the
 * table, its 3 FKs, 4 indexes and both order columns were present.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "shared/database/migrations");
const FILE = "0058_payment_attempt.sql";

/** Reproduces auto-migrate.ts's statement splitting exactly. */
function splitStatements(sql: string): string[] {
  const usesBreakpoints = sql.includes("--> statement-breakpoint");
  if (!usesBreakpoints) {
    const trimmed = sql.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (s.endsWith(";") && !s.includes("$$")) return s.slice(0, -1).trim();
      return s;
    })
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

describe("0058 migration — discovery by the real runner", () => {
  it("sorts directly after 0057", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const index = files.indexOf(FILE);
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe("0057_whatsapp_config.sql");
  });
});

describe("0058 migration — statements the runner will execute", () => {
  const statements = splitStatements(readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf-8"));

  it("keeps every statement — the header comment swallows nothing", () => {
    expect(statements).toHaveLength(11); // type, table, 3 FKs, 4 indexes, 2 order columns
    expect(statements[0]).toMatch(/^CREATE TYPE "public"\."payment_attempt_status" AS ENUM/);
    expect(statements[1]).toMatch(/^CREATE TABLE IF NOT EXISTS "payment_attempt"/);
    expect(statements.filter((s) => /FOREIGN KEY/.test(s))).toHaveLength(3);
    expect(statements.filter((s) => /^CREATE (UNIQUE )?INDEX IF NOT EXISTS/.test(s))).toHaveLength(4);
  });

  it("enforces one order per attempt and one attempt per Fawaterak intent", () => {
    expect(statements).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempt_order_id_idx" ON "payment_attempt" USING btree ("order_id")',
    );
    expect(statements).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempt_intent_key_idx" ON "payment_attempt" USING btree ("intent_key")',
    );
  });

  it("has no time-based expiry anywhere (no expires_at / timeout columns)", () => {
    const all = statements.join("\n").toLowerCase();
    expect(all).not.toMatch(/expires_at|valid_until|timeout|reservation/);
  });

  it("changes existing tables only additively (nullable order columns, no DROP)", () => {
    const orderStatements = statements.filter((s) => s.startsWith('ALTER TABLE "order"'));
    expect(orderStatements).toEqual([
      'ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "fulfillment_hold" text',
      'ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "fulfillment_hold_note" text',
    ]);
    for (const statement of statements) {
      expect(statement.toUpperCase()).not.toContain("DROP ");
    }
  });
});
