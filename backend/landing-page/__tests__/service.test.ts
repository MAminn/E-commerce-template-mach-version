import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Either } from "effect";
import * as schema from "#root/shared/database/drizzle/schema";
import { provideDatabase } from "#root/shared/trpc/server";
import {
  DEFAULT_LANDING_PAGE_SETTINGS,
  type LandingPageSettings,
} from "#root/shared/landing-page/config";
import { landingPageSettingsSchema } from "../trpc";
import {
  getLandingPageEditorState,
  getLandingPageSettings,
  updateLandingPageSettings,
} from "../service";

/**
 * The service run through drizzle's real query builder against a stub pg
 * client (rowMode "array": a row is its values in select order), as in
 * backend/whatsapp/__tests__/service.test.ts.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

interface CatalogueRow {
  id: string;
  name: string;
  hidden?: boolean;
  deleted?: boolean;
}

function makeDb(
  stored: Partial<LandingPageSettings> | null,
  catalogue: CatalogueRow[] = [],
) {
  const writes: unknown[] = [];
  let current = stored;
  const client = {
    query: async (query: { text: string }, params: unknown[]) => {
      const sql = query.text;
      if (sql.startsWith('select "landing_page_config"')) {
        return { rows: [[current]] };
      }
      if (sql.startsWith("select") && sql.includes('from "product"')) {
        const ids = params as string[];
        // id, name, price, discount_price, stock, diskname, hidden, deleted
        return {
          rows: catalogue
            .filter((p) => ids.includes(p.id))
            .map((p) => [p.id, p.name, "100.00", null, 5, null, p.hidden ?? false, p.deleted ?? false]),
        };
      }
      if (sql.startsWith("update")) {
        current = JSON.parse(params[0] as string);
        writes.push(current);
        return { rows: [[current]] };
      }
      return { rows: [] };
    },
  };
  return { db: drizzle(client as never, { schema }), writes };
}

const run = <A, E, R>(db: ReturnType<typeof drizzle>, effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    Effect.either(effect).pipe(provideDatabase({ db: db as never }) as never) as Effect.Effect<
      Either.Either<A, E>
    >,
  );

function input(patch: Partial<LandingPageSettings> = {}): LandingPageSettings {
  return { ...structuredClone(DEFAULT_LANDING_PAGE_SETTINGS), ...patch };
}

describe("landing page service", () => {
  it("a store that never saved the page gets the defaults", async () => {
    const { db } = makeDb(null);
    const res = await run(db, getLandingPageSettings());
    expect(Either.getOrThrow(res)).toEqual(DEFAULT_LANDING_PAGE_SETTINGS);
  });

  it("saves the canonical value and returns it", async () => {
    const { db, writes } = makeDb(null, [
      { id: A, name: "Whey" },
      { id: B, name: "Creatine" },
    ]);
    const res = await run(
      db,
      updateLandingPageSettings(
        input({
          hero: { ...DEFAULT_LANDING_PAGE_SETTINGS.hero, title: "  Ramadan offer " },
          productIds: [B, A],
        }),
      ),
    );
    const saved = Either.getOrThrow(res);
    expect(saved.hero.title).toBe("Ramadan offer");
    expect(saved.productIds).toEqual([B, A]);
    expect(writes).toHaveLength(1);
  });

  it("refuses ids that are not live catalogue products, and writes nothing", async () => {
    const { db, writes } = makeDb(null, [
      { id: A, name: "Whey" },
      { id: B, name: "Gone", deleted: true },
    ]);
    const res = await run(db, updateLandingPageSettings(input({ productIds: [A, B] })));
    expect(Either.isLeft(res)).toBe(true);
    if (Either.isLeft(res)) {
      expect((res.left as { clientMessage: string }).clientMessage).toMatch(
        /no longer exist/,
      );
    }
    expect(writes).toHaveLength(0);
  });

  it("refuses an unsafe link server-side too, and writes nothing", async () => {
    const { db, writes } = makeDb(null);
    const res = await run(
      db,
      updateLandingPageSettings(
        input({
          hero: { ...DEFAULT_LANDING_PAGE_SETTINGS.hero, ctaLink: "javascript:alert(1)" },
        }),
      ),
    );
    expect(Either.isLeft(res)).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("the editor state lists picked products in order and flags hidden ones", async () => {
    const { db } = makeDb({ productIds: [B, A] }, [
      { id: A, name: "Whey" },
      { id: B, name: "Creatine", hidden: true },
    ]);
    const state = Either.getOrThrow(await run(db, getLandingPageEditorState()));
    expect(state.selectedProducts.map((p) => [p.name, p.hidden])).toEqual([
      ["Creatine", true],
      ["Whey", false],
    ]);
  });

  it("the tRPC schema accepts what the editor sends", () => {
    expect(landingPageSettingsSchema.safeParse(DEFAULT_LANDING_PAGE_SETTINGS).success).toBe(true);
  });
});
