import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 0059 adds the order_reference registry (unique "ORD-XXXXXXXX" references),
 * order.reference / payment_attempt.reference, and the provider
 * reconciliation columns. Applied to a disposable Postgres restored from
 * mach-local.dump through the real runner (`✅ Applied:
 * 0059_order_reference_and_reconciliation.sql`; a second run applied 0).
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "shared/database/migrations");
const FILE = "0059_order_reference_and_reconciliation.sql";

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.endsWith(";") && !s.includes("$$") ? s.slice(0, -1).trim() : s))
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

describe("0059 migration", () => {
  const statements = splitStatements(readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf-8"));

  it("sorts directly after 0058", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.indexOf(FILE) - 1]).toBe("0058_payment_attempt.sql");
  });

  it("keeps every statement (the header comment swallows nothing)", () => {
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "order_reference"/);
    expect(statements).toHaveLength(13); // table, 2 backfills, 2 reference columns + 2 unique indexes, 5 reconcile columns + index
  });

  it("reserves legacy numbers without rewriting any order", () => {
    const backfills = statements.filter((s) => s.startsWith('INSERT INTO "order_reference"'));
    expect(backfills).toHaveLength(2);
    for (const b of backfills) {
      expect(b).toContain("ON CONFLICT DO NOTHING");
      expect(b).toContain("substr(replace(\"id\"::text, '-', ''), 1, 8)"); // the legacy derivation
    }
    expect(statements.some((s) => /^UPDATE\s+"order"/i.test(s))).toBe(false);
  });

  it("enforces unique references and is otherwise additive", () => {
    expect(statements).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "order_reference_idx" ON "order" USING btree ("reference")');
    expect(statements).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempt_reference_idx" ON "payment_attempt" USING btree ("reference")',
    );
    for (const s of statements) expect(s.toUpperCase()).not.toContain("DROP ");
  });

  it("schedules polling only — no expiry column", () => {
    const all = statements.join("\n").toLowerCase();
    expect(all).toContain("next_provider_check_at");
    expect(all).not.toMatch(/expires_at|valid_until|expiry/);
  });
});
