import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { ClientSession } from "#root/backend/auth/shared/entities";

// Real-Postgres integration test for the Orders dashboard search — see
// docs/MARKETING_SUITE_PLAN.md "Running the DB integration tests".
//
// Regression: the dashboard used to filter only the 20 rows of the page on
// screen, so an order on page 3 could only be found from page 3. Search must
// be applied in SQL before limit/offset, across the whole order history.

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const PAGE_SIZE = 20; // the dashboard's page size
const ORDER_COUNT = 65; // 4 pages: 20 / 20 / 20 / 5

/** New-style reference for the i-th seeded order (unique 8 hex chars). */
const refOf = (i: number) => `ORD-${(0xa0000000 + i).toString(16).toUpperCase()}`;

/** Legacy order (no stored reference): number = first 8 hex chars of its id. */
const LEGACY_ID = "deadbeef-0000-7000-8000-000000000001";

describeIfDb("view orders — server-side search (integration)", () => {
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
  };
  let viewOrders: typeof import("../service").viewOrders;
  let viewOrdersSchema: typeof import("../service").viewOrdersSchema;
  let provideDatabase: typeof import("#root/shared/trpc/server").provideDatabase;

  /** index → order id; index 0 is the NEWEST order (page 1, row 1). */
  const ids: string[] = [];

  const admin: ClientSession = {
    id: "search-admin",
    token: "t",
    email: "admin@example.com",
    name: "Admin",
    phone: "",
    expiresAt: new Date(Date.now() + 3_600_000),
    role: "admin",
  };
  const shopper: ClientSession = {
    ...admin,
    id: "search-shopper",
    email: "shopper@example.com",
    name: "Shopper",
    role: "user",
  };

  /** Runs the service exactly as the tRPC procedure does (input parsed by zod). */
  async function view(input: Record<string, unknown>, session: ClientSession = admin) {
    const parsed = viewOrdersSchema.parse({ limit: PAGE_SIZE, offset: 0, ...input });
    const result = await Effect.runPromise(
      viewOrders(parsed, session).pipe(provideDatabase({ db: db as never })),
    );
    return result as { items: { id: string }[]; total: number; totalSales?: number };
  }

  /** Page (1-based) the i-th order sits on in the unfiltered list. */
  const pageOf = (i: number) => Math.floor(i / PAGE_SIZE) + 1;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    db = drizzle(TEST_DB_URL ?? "", { schema });
    ({ viewOrders, viewOrdersSchema } = await import("../service"));
    ({ provideDatabase } = await import("#root/shared/trpc/server"));
    const { v7 } = await import("uuid");

    await db.execute(
      sql`truncate order_item, payment_attempt, order_reference, "order", product, category, vendor, file, "user" cascade`,
    );

    const fileId = v7();
    await db.insert(schema.file).values({ id: fileId, diskname: "search-test.jpg" });
    const categoryId = v7();
    await db.insert(schema.category).values({ id: categoryId, name: "Search Cat", slug: "search-cat" });
    const vendorId = v7();
    await db.insert(schema.vendor).values({ id: vendorId, name: "Search Vendor" });
    const productId = v7();
    await db.insert(schema.product).values({
      id: productId,
      name: "Search Product",
      slug: "search-product",
      description: "d",
      price: "100.00",
      imageId: fileId,
      categoryId,
      vendorId,
    });

    await db.insert(schema.user).values({
      id: shopper.id,
      name: shopper.name,
      email: shopper.email,
    });

    const base = {
      customerPhone: "01000000000",
      shippingAddress: "1 Test St",
      shippingCity: "Nasr City",
      shippingState: "Cairo",
      shippingCountry: "Egypt",
      shippingPostalCode: "",
      subtotal: "100.00",
      shipping: "0.00",
      tax: "0.00",
      total: "100.00",
    };

    // Same name on pages 1, 3 and 4 to prove multi-page matches come back together.
    const REPEATED_NAME = new Set([4, 45, 61]);
    // The shopper owns exactly one order (page 4) — matching name for a permissions check.
    const SHOPPER_ORDER = 61;

    const t0 = Date.parse("2026-11-01T12:00:00Z");
    const rows = [];
    for (let i = 0; i < ORDER_COUNT; i++) {
      const id = i === 50 ? LEGACY_ID : v7();
      ids.push(id);
      rows.push({
        ...base,
        id,
        reference: i === 50 ? null : refOf(i),
        userId: i === SHOPPER_ORDER ? shopper.id : null,
        // Newest first: order 0 is the most recent.
        createdAt: new Date(t0 - i * 60_000),
        customerName: REPEATED_NAME.has(i) ? "Nour Repeated" : `Customer ${String(i).padStart(2, "0")}`,
        customerEmail: `customer${i}@example.com`,
        total: (100 + i).toFixed(2),
        status: i % 2 === 0 ? ("pending" as const) : ("delivered" as const),
      });
    }
    await db.insert(schema.order).values(rows);

    // 25 orders share an item name — spans two pages once filtered.
    await db.insert(schema.orderItem).values(
      ids.map((orderId, i) => ({
        orderId,
        productId,
        vendorId,
        quantity: 1,
        price: "100.00",
        name: i >= 30 && i < 55 ? "Bulk Whey 2kg" : `Plain Item ${i}`,
      })),
    );
  });

  afterAll(async () => {
    await db.execute(
      sql`truncate order_item, "order", product, category, vendor, file, "user" cascade`,
    );
    await db.$client.end();
  });

  it("unfiltered list paginates the whole history (baseline)", async () => {
    const page1 = await view({});
    expect(page1.total).toBe(ORDER_COUNT);
    expect(page1.items.map((o) => o.id)).toEqual(ids.slice(0, 20));
    const page4 = await view({ offset: 60 });
    expect(page4.items.map((o) => o.id)).toEqual(ids.slice(60));
  });

  it("finds an order on ANY page by its order number while asking for page 1", async () => {
    for (const i of [0, 19, 20, 39, 40, 59, 60, 64]) {
      const res = await view({ search: refOf(i).slice(4) }); // "#XXXXXXXX" without '#'
      expect(res.total, `order ${i} (page ${pageOf(i)})`).toBe(1);
      expect(res.items.map((o) => o.id)).toEqual([ids[i]]);
    }
  });

  it("accepts the number as shown (#…), as the ORD- reference, lowercase, or partial", async () => {
    const i = 47; // page 3
    for (const q of [`#${refOf(i).slice(4)}`, refOf(i), refOf(i).toLowerCase(), refOf(i).slice(-5)]) {
      const res = await view({ search: q });
      expect(res.items.map((o) => o.id), q).toEqual([ids[i]]);
    }
  });

  it("finds a legacy order (no stored reference) by its legacy number", async () => {
    const res = await view({ search: "#DEADBEEF" });
    expect(res.items.map((o) => o.id)).toEqual([LEGACY_ID]);
    expect(pageOf(50)).toBe(3);
  });

  it("still searches by customer name, email, order id and item name across pages", async () => {
    const byName = await view({ search: "nour repeated" });
    expect(byName.total).toBe(3);
    expect(byName.items.map((o) => o.id)).toEqual([ids[4], ids[45], ids[61]]);

    expect((await view({ search: "customer58@example.com" })).items.map((o) => o.id)).toEqual([ids[58]]);
    expect((await view({ search: String(ids[42]) })).items.map((o) => o.id)).toEqual([ids[42]]);
    expect((await view({ search: "Plain Item 63" })).items.map((o) => o.id)).toEqual([ids[63]]);
  });

  it("applies search BEFORE pagination: totals and pages cover only the matches", async () => {
    const page1 = await view({ search: "bulk whey" });
    expect(page1.total).toBe(25);
    expect(page1.items.map((o) => o.id)).toEqual(ids.slice(30, 50));
    // Sum of (100 + i) for i = 30..54
    expect(page1.totalSales).toBe(25 * 100 + (30 + 54) * 25 / 2);

    const page2 = await view({ search: "bulk whey", offset: 20 });
    expect(page2.total).toBe(25);
    expect(page2.items.map((o) => o.id)).toEqual(ids.slice(50, 55));

    // An old page offset with a narrow search is empty — why the UI resets to page 1.
    const stale = await view({ search: refOf(5).slice(4), offset: 40 });
    expect(stale.total).toBe(1);
    expect(stale.items).toEqual([]);
  });

  it("returns an empty result for a search with no matches", async () => {
    for (const q of ["no-such-order-xyz", "#FFFFFFFF", "%", "_"]) {
      const res = await view({ search: q });
      expect(res, q).toMatchObject({ items: [], total: 0, totalSales: 0 });
    }
  });

  it("treats a blank search as no search", async () => {
    expect((await view({ search: "   " })).total).toBe(ORDER_COUNT);
    expect((await view({ search: "" })).total).toBe(ORDER_COUNT);
  });

  it("combines search with the existing status and date filters", async () => {
    // Order 47 is "delivered" (odd index).
    expect((await view({ search: refOf(47), status: "delivered" })).items.map((o) => o.id)).toEqual([ids[47]]);
    expect((await view({ search: refOf(47), status: "pending" })).total).toBe(0);

    const created47 = Date.parse("2026-11-01T12:00:00Z") - 47 * 60_000;
    const inRange = await view({
      search: refOf(47),
      dateFrom: new Date(created47).toISOString(),
      dateTo: new Date(created47 + 1).toISOString(),
    });
    expect(inRange.items.map((o) => o.id)).toEqual([ids[47]]);
    const outOfRange = await view({
      search: refOf(47),
      dateFrom: new Date(created47 + 1).toISOString(),
    });
    expect(outOfRange.total).toBe(0);

    // "Nour Repeated" = orders 4 (pending), 45 (delivered), 61 (delivered).
    expect((await view({ search: "Nour Repeated", status: "delivered" })).items.map((o) => o.id)).toEqual([
      ids[45],
      ids[61],
    ]);
  });

  it("keeps non-admin users limited to their own orders", async () => {
    const own = await view({ search: "Nour Repeated" }, shopper);
    expect(own.items.map((o) => o.id)).toEqual([ids[61]]);
    expect((await view({ search: refOf(3) }, shopper)).total).toBe(0);
  });

  it("rejects an over-long search like the CSV export does", () => {
    expect(() => viewOrdersSchema.parse({ search: "x".repeat(201) })).toThrow();
  });
});
