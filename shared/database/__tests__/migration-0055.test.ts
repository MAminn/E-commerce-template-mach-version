import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 0055 adds `product_review.import_key` + its unique index for the review
 * CSV importer. As with 0054, what matters is how the boot-time runner in
 * shared/database/auto-migrate.ts will actually execute it — see the header
 * of migration-0054.test.ts for the runner's rules. Applying it against a
 * real database was verified separately (a disposable Postgres restored from
 * mach-local.dump; the runner logged `✅ Applied: 0055_review_import_key.sql`
 * and the column + unique index were present afterwards).
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "shared/database/migrations");
const FILE = "0055_review_import_key.sql";

function discoverMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

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

describe("0055 migration — discovery by the real runner", () => {
  it("sorts directly after 0054", () => {
    const files = discoverMigrationFiles();
    const index = files.indexOf(FILE);
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe("0054_pixel_delivery_diagnostics.sql");
  });

  it("is listed in the drizzle journal with idx 55", () => {
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { idx: number; tag: string }[] };
    const entry = journal.entries.find((e) => e.tag === "0055_review_import_key");
    expect(entry?.idx).toBe(55);
  });
});

describe("0055 migration — statements the runner will execute", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf-8");
  const statements = splitStatements(sql);

  it("keeps both statements — the header comment does not swallow the ALTER", () => {
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^ALTER TABLE "product_review" ADD COLUMN IF NOT EXISTS "import_key" text$/);
    expect(statements[1]).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS "product_review_import_key_idx" ON "product_review"/);
  });

  it("is additive, nullable and re-runnable", () => {
    for (const statement of statements) {
      expect(statement).toContain("IF NOT EXISTS");
      expect(statement.toUpperCase()).not.toContain("NOT NULL");
      expect(statement.toUpperCase()).not.toContain("DROP");
    }
  });

  it("touches only product_review", () => {
    for (const statement of statements) {
      expect(statement).toContain('"product_review"');
    }
  });
});
