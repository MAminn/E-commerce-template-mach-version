import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Either } from "effect";
import * as schema from "#root/shared/database/drizzle/schema";
import { provideDatabase } from "#root/shared/trpc/server";
import type { WhatsAppSettings } from "#root/shared/whatsapp/config";
import { whatsappSettingsSchema } from "../trpc";
import {
  getPublicWhatsAppButton,
  getWhatsAppSettings,
  updateWhatsAppSettings,
} from "../service";

/**
 * The service run through drizzle's real query builder against a stub pg
 * client (rowMode "array": a row is its values in select order), as in
 * backend/upsells/__tests__/service.test.ts.
 */

interface Capture {
  sql: string;
  params: unknown[];
}

function makeDb(stored: Partial<WhatsAppSettings> | null, { rowExists = true } = {}) {
  const captures: Capture[] = [];
  let current = stored;
  const client = {
    query: async (query: { text: string }, params: unknown[]) => {
      const sql = query.text;
      captures.push({ sql, params });
      if (sql.startsWith("select")) {
        return { rows: rowExists ? [[current]] : [] };
      }
      if (sql.startsWith("update")) {
        if (!rowExists) return { rows: [] };
        current = JSON.parse(params[0] as string);
        return { rows: [[current]] };
      }
      if (sql.startsWith("insert")) {
        current = JSON.parse(params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
        return { rows: [[current]] };
      }
      return { rows: [] };
    },
  };
  return { db: drizzle(client as never, { schema }), captures };
}

const run = <A, E, R>(db: ReturnType<typeof drizzle>, effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    Effect.either(effect).pipe(provideDatabase({ db: db as never }) as never) as Effect.Effect<Either.Either<A, E>>,
  );

describe("getWhatsAppSettings / getPublicWhatsAppButton", () => {
  it("existing stores with no saved config default to off and no public button", async () => {
    const { db } = makeDb(null);
    const settings = await run(db, getWhatsAppSettings());
    expect(Either.getOrThrow(settings)).toEqual({
      enabled: false,
      phoneNumber: "",
      message: "",
      visibility: "both",
    });
    expect(Either.getOrThrow(await run(db, getPublicWhatsAppButton()))).toBeNull();
  });

  it("a store with no settings row at all is also off", async () => {
    const { db } = makeDb(null, { rowExists: false });
    expect(Either.getOrThrow(await run(db, getPublicWhatsAppButton()))).toBeNull();
  });

  it("enabled with a valid number → a ready wa.me link", async () => {
    const { db } = makeDb({ enabled: true, phoneNumber: "201012345678", message: "Hi MACH", visibility: "mobile" });
    expect(Either.getOrThrow(await run(db, getPublicWhatsAppButton()))).toEqual({
      href: "https://wa.me/201012345678?text=Hi%20MACH",
      visibility: "mobile",
    });
  });

  it("the public payload carries no raw number or message fields", async () => {
    const { db } = makeDb({ enabled: true, phoneNumber: "201012345678", message: "Hi" });
    const button = Either.getOrThrow(await run(db, getPublicWhatsAppButton()));
    expect(Object.keys(button ?? {}).sort()).toEqual(["href", "visibility"]);
  });
});

describe("updateWhatsAppSettings", () => {
  it("rejects enabling without a number and writes nothing", async () => {
    const { db, captures } = makeDb(null);
    const r = await run(
      db,
      updateWhatsAppSettings({ enabled: true, phoneNumber: "", message: "", visibility: "both" }),
    );
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      const err = r.left as { clientMessage: string; statusCode: number };
      expect(err.statusCode).toBe(400);
      expect(err.clientMessage).toMatch(/required to turn the button on/);
    }
    expect(captures).toHaveLength(0);
  });

  it("rejects a local number without a country code", async () => {
    const { db, captures } = makeDb(null);
    const r = await run(
      db,
      updateWhatsAppSettings({ enabled: true, phoneNumber: "01012345678", message: "", visibility: "both" }),
    );
    expect(Either.isLeft(r)).toBe(true);
    expect(captures).toHaveLength(0);
  });

  it("saving off with an empty number is allowed (deployable default)", async () => {
    const { db } = makeDb(null);
    const r = await run(
      db,
      updateWhatsAppSettings({ enabled: false, phoneNumber: "", message: "", visibility: "both" }),
    );
    expect(Either.getOrThrow(r)).toEqual({ enabled: false, phoneNumber: "", message: "", visibility: "both" });
  });

  it("stores the normalised digits, trimmed message, only in whatsapp_config", async () => {
    const { db, captures } = makeDb(null);
    const r = await run(
      db,
      updateWhatsAppSettings({
        enabled: true,
        phoneNumber: "+20 10 1234 5678",
        message: "  Hi  ",
        visibility: "desktop",
      }),
    );
    expect(Either.getOrThrow(r)).toEqual({
      enabled: true,
      phoneNumber: "201012345678",
      message: "Hi",
      visibility: "desktop",
    });
    const update = captures.find((c) => c.sql.startsWith("update"))!;
    expect(update.sql).toMatch(/update "store_settings" set "whatsapp_config" = \$1, "updated_at" = \$2/);
    expect(update.sql).not.toMatch(/footer|contact/i);
  });

  it("creates the settings row on a fresh install", async () => {
    const { db, captures } = makeDb(null, { rowExists: false });
    const r = await run(
      db,
      updateWhatsAppSettings({ enabled: true, phoneNumber: "201012345678", message: "", visibility: "both" }),
    );
    expect(Either.getOrThrow(r).phoneNumber).toBe("201012345678");
    expect(captures.some((c) => c.sql.startsWith("insert into \"store_settings\""))).toBe(true);
  });
});

describe("whatsappSettingsSchema (tRPC input)", () => {
  it("accepts the shipped default", () => {
    expect(
      whatsappSettingsSchema.safeParse({ enabled: false, phoneNumber: "", message: "", visibility: "both" }).success,
    ).toBe(true);
  });

  it("rejects an unknown visibility and missing fields", () => {
    expect(
      whatsappSettingsSchema.safeParse({ enabled: true, phoneNumber: "1", message: "", visibility: "tablet" }).success,
    ).toBe(false);
    expect(whatsappSettingsSchema.safeParse({ enabled: true }).success).toBe(false);
  });
});
