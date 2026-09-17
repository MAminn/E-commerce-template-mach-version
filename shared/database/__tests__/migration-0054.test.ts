import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * This repository does NOT apply migrations with `drizzle-kit migrate`.
 *
 * `shared/database/middleware.server.ts` calls `runMigrations()` from
 * `shared/database/auto-migrate.ts` while the Fastify server boots, before the
 * Drizzle instance is created. That runner:
 *
 *   - reads every `*.sql` file in `shared/database/migrations`, sorted by
 *     filename (it never reads `meta/_journal.json`),
 *   - skips any file whose NAME is already a row in `__drizzle_migrations`,
 *   - splits on `--> statement-breakpoint` when present, otherwise runs the
 *     whole file as one statement,
 *   - strips a trailing semicolon only from statements that contain no `$$`,
 *   - and records the filename once every statement succeeded.
 *
 * So the tests below check what actually governs deployment: file discovery,
 * ordering, and that each statement this runner will produce is one the
 * database can execute. Whether Postgres accepts them can only be confirmed
 * against a real database — no database was reachable from this environment.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "shared/database/migrations");
const FILE = "0054_pixel_delivery_diagnostics.sql";

/** Reproduces auto-migrate.ts's file discovery exactly. */
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

describe("0054 migration — discovery by the real runner", () => {
  it("is picked up by the boot-time migration runner", () => {
    // Registration is by filename in the migrations folder. There is no
    // manifest to add it to — but it must sort after its predecessor, or the
    // runner would apply it out of order on a fresh database.
    const files = discoverMigrationFiles();
    expect(files).toContain(FILE);
  });

  it("has a filename that sorts directly after the previous migration", () => {
    const files = discoverMigrationFiles();
    const index = files.indexOf(FILE);
    expect(files[index - 1]).toBe("0053_fawaterak_payment_method.sql");
    expect(files[index - 1]!.localeCompare(FILE)).toBeLessThan(0);
  });

  it("is also listed in the drizzle journal, for drizzle-kit users", () => {
    // Not used by the boot runner, but a missing entry makes `drizzle-kit`
    // regenerate a conflicting migration the next time someone runs it.
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
    ) as { entries: { idx: number; tag: string }[] };

    const entry = journal.entries.find(
      (e) => e.tag === "0054_pixel_delivery_diagnostics",
    );
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(54);
  });
});

describe("0054 migration — statements the runner will execute", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf-8");
  const statements = splitStatements(sql);

  it("splits into the expected statement count", () => {
    // 8 ADD COLUMN + 1 DO block (FK) + 1 CREATE INDEX
    expect(statements).toHaveLength(10);
  });

  it("keeps the DO block intact, semicolon included", () => {
    const doBlock = statements.find((s) => s.startsWith("DO $$"));
    expect(doBlock).toBeDefined();
    // The runner only strips a trailing `;` from statements without `$$`;
    // stripping it here would make the block unparseable.
    expect(doBlock!.trimEnd().endsWith("END $$;")).toBe(true);
  });

  it("adds every diagnostics column the pipeline writes", () => {
    const columns = [
      "pixel_config_id",
      "status_code",
      "platform_code",
      "platform_message",
      "request_id",
      "accepted_count",
      "attempts",
      "skipped_reason",
    ];
    for (const column of columns) {
      expect(
        statements.some(
          (s) =>
            s.includes("ADD COLUMN IF NOT EXISTS") && s.includes(`"${column}"`),
        ),
      ).toBe(true);
    }
  });

  it("is re-runnable: every statement is guarded", () => {
    // The runner re-applies a migration whose row is missing (a fresh
    // database, a reset tracking table). Unguarded DDL would then fail and
    // block the file from ever being marked applied.
    for (const statement of statements) {
      const guarded =
        statement.includes("IF NOT EXISTS") ||
        (statement.startsWith("DO $$") &&
          statement.includes("WHEN duplicate_object THEN null"));
      expect(guarded, `unguarded statement: ${statement.slice(0, 80)}`).toBe(
        true,
      );
    }
  });

  it("adds no NOT NULL column, so existing rows stay valid", () => {
    // Historical delivery rows carry no diagnostics — that is accurate, the
    // old pipeline captured none. A NOT NULL column would need a backfill and
    // would invent data that was never recorded.
    for (const statement of statements) {
      expect(statement.toUpperCase()).not.toContain("NOT NULL");
    }
  });

  it("touches only the delivery table", () => {
    for (const statement of statements) {
      if (!statement.includes("ALTER TABLE") && !statement.includes("CREATE INDEX"))
        continue;
      expect(statement).toContain("tracking_event_delivery");
    }
  });
});
