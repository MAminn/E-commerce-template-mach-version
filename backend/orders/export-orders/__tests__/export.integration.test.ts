import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { parseCsv } from "#root/shared/utils/csv";
import {
  ORDERS_EXPORT_COUNT_HEADER,
  ORDERS_EXPORT_ENDPOINT,
} from "#root/shared/orders/order-export";

// Real-Postgres integration test for the Orders CSV export — see
// docs/MARKETING_SUITE_PLAN.md "Running the DB integration tests". Drives the
// real route against 1,205 seeded orders (more than two 500-order batches and
// far past the dashboard's 20-per-page / 100-max list) and parses the file
// back.

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const FILLER_COUNT = 1200;

describeIfDb("orders CSV export (integration)", () => {
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
  };
  let app: FastifyInstance;

  const ids = {} as Record<"single" | "multi" | "online" | "issue" | "cancelled", string>;

  /** The route as server.ts mounts it, signed in as `role`. */
  async function exportCsv(query = "", role = "admin") {
    const res = await app.inject({
      method: "GET",
      url: `${ORDERS_EXPORT_ENDPOINT}${query ? `?${query}` : ""}`,
      headers: { "x-test-role": role },
    });
    const parsed = parseCsv(res.body);
    expect(parsed.errors).toEqual([]);
    const [header, ...rows] = parsed.records.map((r) => r.fields);
    const objects = rows.map((fields) =>
      Object.fromEntries(header!.map((h, i) => [h, fields[i] ?? ""])),
    );
    return { res, header: header!, rows: objects };
  }

  /** Every order + item value, to prove the export changed nothing. */
  async function dataFingerprint(): Promise<string> {
    const result = await db.execute(
      sql`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from (
            select o::text as t from "order" o
            union all select i::text from order_item i
            union all select p::text from promo_code p
            union all select a::text from payment_attempt a) s`,
    );
    return (result.rows[0] as { h: string }).h;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    db = drizzle(TEST_DB_URL!, { schema });
    const { v7 } = await import("uuid");
    const { ordersExportApiPlugin } = await import("../api");

    await db.execute(
      sql`truncate order_item, payment_attempt, order_reference, "order", promo_code, product, category, vendor, file, "user" cascade`,
    );

    const fileId = v7();
    await db.insert(schema.file).values({ id: fileId, diskname: "export-test.jpg" });
    const categoryId = v7();
    await db.insert(schema.category).values({ id: categoryId, name: "Export Cat", slug: "export-cat" });
    const vendorId = v7();
    await db.insert(schema.vendor).values({ id: vendorId, name: "Export Vendor" });

    const whey = v7();
    const creatine = v7();
    await db.insert(schema.product).values([
      { id: whey, name: "Whey Protein", slug: "whey", sku: "WP-1", description: "d", price: "1000.00", imageId: fileId, categoryId, vendorId },
      { id: creatine, name: "Creatine", slug: "creatine", description: "d", price: "550.00", imageId: fileId, categoryId, vendorId },
    ]);

    const userId = "export-test-user";
    await db.insert(schema.user).values({
      id: userId,
      name: "Account Holder",
      email: "holder@example.com",
      phone: "01155555555",
    });

    const promoId = v7();
    await db.insert(schema.promoCode).values({
      id: promoId,
      code: "MACH10",
      discountType: "percentage",
      discountValue: "10.00",
      status: "active",
    });

    const base = {
      customerEmail: "c@example.com",
      shippingCountry: "Egypt",
      shippingPostalCode: "",
      tax: "0.00",
    };

    ids.single = v7();
    ids.multi = v7();
    ids.online = v7();
    ids.issue = v7();
    ids.cancelled = v7();

    await db.insert(schema.order).values([
      {
        ...base,
        id: ids.single,
        reference: "ORD-A1B2C3D4",
        customerName: "Single Buyer",
        customerPhone: "01012345678",
        shippingAddress: "12 Abbas El Akkad (Bldg 5, Apt 12)",
        shippingCity: "Nasr City / 8th District",
        shippingState: "Cairo",
        shippingDistrict: "bosta:d-1",
        subtotal: "1000.00",
        shipping: "60.00",
        total: "1060.00",
        status: "pending",
        createdAt: new Date("2026-10-10T10:00:00Z"),
      },
      {
        ...base,
        id: ids.multi,
        userId,
        customerName: "محمد أحمد",
        customerPhone: "01098765432",
        shippingAddress: "١٢ شارع التحرير، الدور الثالث",
        shippingCity: "الدقي",
        shippingState: "الجيزة",
        subtotal: "2550.00",
        discount: "255.00",
        promoCodeId: promoId,
        shipping: "75.00",
        total: "2370.00",
        status: "delivered",
        notes: "اتصل قبل التوصيل, شكرا",
        createdAt: new Date("2026-10-11T10:00:00Z"),
      },
      {
        ...base,
        id: ids.online,
        customerName: "Online Payer",
        customerPhone: "+201234567890",
        shippingAddress: "Online St",
        shippingCity: "Smouha",
        shippingState: "Alexandria",
        subtotal: "550.00",
        discount: "50.00",
        shipping: "60.00",
        total: "560.00",
        status: "processing",
        paymentMethod: "fawaterak",
        paymentStatus: "paid",
        paymentTransactionId: "998877665544",
        paymentSessionId: "SECRET-SESSION-KEY",
        paymentGatewayData: { secretToken: "SHOULD-NOT-EXPORT" },
        bostaSyncStatus: "sent",
        bostaTrackingNumber: "7123456789",
        bostaDeliveryId: "bosta-del-1",
        bostaStatus: "In transit",
        createdAt: new Date("2026-10-12T10:00:00Z"),
      },
      {
        ...base,
        id: ids.issue,
        customerName: "Issue Customer",
        customerPhone: "01200000000",
        shippingAddress: "Issue St",
        shippingCity: "Maadi",
        shippingState: "Cairo",
        subtotal: "550.00",
        shipping: "60.00",
        total: "610.00",
        status: "shipped",
        paymentMethod: "fawaterak",
        paymentStatus: "pending",
        bostaSyncStatus: "sent",
        createdAt: new Date("2026-10-13T10:00:00Z"),
      },
      {
        ...base,
        id: ids.cancelled,
        customerName: "Cancelled Customer",
        customerPhone: "01500000000",
        shippingAddress: "Cancel St",
        shippingCity: "Zamalek",
        shippingState: "Cairo",
        subtotal: "1000.00",
        shipping: "60.00",
        total: "1060.00",
        status: "cancelled",
        createdAt: new Date("2026-10-14T10:00:00Z"),
      },
    ]);

    await db.insert(schema.orderItem).values([
      { orderId: ids.single, productId: whey, vendorId, quantity: 1, price: "1000.00", name: "Whey Protein" },
      { orderId: ids.multi, productId: whey, vendorId, quantity: 2, price: "1000.00", discountPrice: "1000.00", name: "Whey Protein (شوكولاتة, 2kg)", createdAt: new Date("2026-10-11T10:00:00Z") },
      { orderId: ids.multi, productId: creatine, vendorId, quantity: 1, price: "550.00", name: "Creatine", createdAt: new Date("2026-10-11T10:00:01Z") },
      { orderId: ids.online, productId: creatine, vendorId, quantity: 1, price: "550.00", name: "Creatine" },
      { orderId: ids.issue, productId: creatine, vendorId, quantity: 1, price: "550.00", name: "Creatine" },
      { orderId: ids.cancelled, productId: whey, vendorId, quantity: 1, price: "1000.00", name: "Whey Protein" },
    ]);

    await db.insert(schema.paymentAttempt).values({
      id: ids.online,
      orderId: ids.online,
      status: "materialized",
      fingerprint: "fp",
      customerName: "Online Payer",
      customerEmail: "c@example.com",
      customerPhone: "+201234567890",
      orderSnapshot: {} as never,
      itemsSnapshot: [] as never,
      subtotal: "550.00",
      discount: "50.00",
      shipping: "60.00",
      total: "560.00",
      currency: "EGP",
      // The code itself was deleted later; the attempt kept its name.
      promoCode: "OLDCODE",
      providerPaymentMethod: "Card",
    });

    const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"] as const;
    const fillers = Array.from({ length: FILLER_COUNT }, (_, i) => ({
      ...base,
      id: v7(),
      customerName: `Filler ${i}`,
      customerPhone: `010${String(i).padStart(8, "0")}`,
      shippingAddress: `Street ${i}`,
      shippingCity: "Heliopolis",
      shippingState: "Cairo",
      subtotal: "100.00",
      shipping: "50.00",
      total: (150 + (i % 7) + 0.25).toFixed(2),
      status: statuses[i % statuses.length]!,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
    }));
    for (let i = 0; i < fillers.length; i += 300) {
      const chunk = fillers.slice(i, i + 300);
      await db.insert(schema.order).values(chunk);
      await db.insert(schema.orderItem).values(
        chunk.map((o) => ({ orderId: o.id, productId: whey, vendorId, quantity: 1, price: "100.00", name: "Whey Protein" })),
      );
    }

    app = Fastify();
    app.decorateRequest("clientSession", undefined);
    app.addHook("onRequest", async (req) => {
      const role = req.headers["x-test-role"];
      req.clientSession =
        typeof role === "string"
          ? ({ id: "u1", role } as unknown as NonNullable<typeof req.clientSession>)
          : undefined;
    });
    await app.register(ordersExportApiPlugin, { getDb: () => db as never });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$client.end();
  });

  it("exports the full history — every order once, totals unchanged", async () => {
    const before = await dataFingerprint();
    const { res, header, rows } = await exportCsv();
    const after = await dataFingerprint();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="MACH_Orders_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(header[0]).toBe("Order Number");

    const dbCount = await db.execute(sql`select count(*)::int as n, sum(total)::text as s from "order"`);
    const { n, s } = dbCount.rows[0] as { n: number; s: string };
    expect(n).toBe(FILLER_COUNT + 5);
    expect(rows).toHaveLength(n);
    expect(res.headers[ORDERS_EXPORT_COUNT_HEADER]).toBe(String(n));
    expect(new Set(rows.map((r) => r["Order ID"])).size).toBe(n);

    const exportedCents = rows.reduce((sum, r) => sum + Math.round(Number(r["Order Total"]) * 100), 0);
    expect(exportedCents).toBe(Math.round(Number(s) * 100));

    // Newest first, like the dashboard.
    expect(rows[0]!["Order ID"]).toBe(ids.cancelled);
    expect(rows.at(-1)!["Customer Name"]).toBe("Filler 0");

    expect(after).toBe(before);
  }, 60_000);

  it("writes single- and multi-product orders correctly", async () => {
    const { rows } = await exportCsv();
    const single = rows.find((r) => r["Order ID"] === ids.single)!;
    expect(single["Order Number"]).toBe("#A1B2C3D4");
    expect(single.Phone).toBe('="01012345678"');
    expect(single["Building / Apartment"]).toBe("Bldg 5, Apt 12");
    expect(single["Bosta District ID"]).toBe("d-1");
    expect(single["Line Items"]).toBe("1");
    expect(single.SKUs).toBe("WP-1");
    expect(single["Promo Code"]).toBe("");
    expect(single.Discount).toBe("");
    expect(single["Order Total"]).toBe("1060.00");
    expect(single["Payment Method"]).toBe("Cash on Delivery");
    expect(single.Currency).toBe("EGP");

    const multi = rows.find((r) => r["Order ID"] === ids.multi)!;
    expect(multi["Customer Name"]).toBe("محمد أحمد");
    expect(multi.Governorate).toBe("الجيزة");
    expect(multi["City / Area"]).toBe("الدقي");
    expect(multi["Shipping Address"]).toBe("١٢ شارع التحرير، الدور الثالث");
    expect(multi["Customer Notes"]).toBe("اتصل قبل التوصيل, شكرا");
    expect(multi["Account Phone (if different)"]).toBe('="01155555555"');
    expect(multi["Line Items"]).toBe("2");
    expect(multi["Product Names"]).toBe("Whey Protein\nCreatine");
    expect(multi.Variants).toBe("شوكولاتة, 2kg\n");
    expect(multi.Quantities).toBe("2\n1");
    expect(multi["Unit Prices"]).toBe("1000.00\n550.00");
    expect(multi["Line Totals"]).toBe("2000.00\n550.00");
    expect(multi.Subtotal).toBe("2550.00");
    expect(multi.Discount).toBe("255.00");
    expect(multi["Promo Code"]).toBe("MACH10");
    expect(multi["Shipping Fee"]).toBe("75.00");
    expect(multi["Order Total"]).toBe("2370.00");
    expect(multi["Order Status"]).toBe("delivered");
  });

  it("exports online payment and Bosta details but no gateway secrets", async () => {
    const { res, rows } = await exportCsv();
    const online = rows.find((r) => r["Order ID"] === ids.online)!;
    expect(online["Payment Method"]).toBe("Online (Fawaterak)");
    expect(online["Payment Status"]).toBe("Paid");
    expect(online["Gateway Payment Type"]).toBe("Card");
    expect(online["Payment Transaction ID"]).toBe('="998877665544"');
    expect(online["Promo Code"]).toBe("OLDCODE");
    expect(online.Phone).toBe('="+201234567890"');
    expect(online["Bosta Tracking Number"]).toBe('="7123456789"');
    expect(online["Bosta Shipment Status"]).toBe("In transit");
    expect(res.body).not.toContain("SECRET-SESSION-KEY");
    expect(res.body).not.toContain("SHOULD-NOT-EXPORT");
  });

  it("applies the dashboard's status filter", async () => {
    const { rows, res } = await exportCsv("status=delivered");
    const expected = await db.execute(sql`select count(*)::int as n from "order" where status = 'delivered'`);
    expect(rows).toHaveLength((expected.rows[0] as { n: number }).n);
    expect(res.headers[ORDERS_EXPORT_COUNT_HEADER]).toBe(String(rows.length));
    expect(rows.every((r) => r["Order Status"] === "delivered")).toBe(true);
    expect(rows.some((r) => r["Order ID"] === ids.multi)).toBe(true);
  });

  it("applies the dashboard's date range", async () => {
    const { rows } = await exportCsv(
      "dateFrom=2026-10-11T00:00:00.000Z&dateTo=2026-10-12T00:00:00.000Z",
    );
    expect(rows.map((r) => r["Order ID"])).toEqual([ids.multi]);
  });

  it("applies the payment-issues filter", async () => {
    const { rows } = await exportCsv("paymentIssueOnly=true");
    expect(rows.map((r) => r["Order ID"])).toEqual([ids.issue]);
  });

  it("combines filters", async () => {
    const { rows } = await exportCsv(
      "status=cancelled&dateFrom=2026-10-01T00:00:00.000Z",
    );
    expect(rows.map((r) => r["Order ID"])).toEqual([ids.cancelled]);
  });

  it("applies the search box across the whole history", async () => {
    expect((await exportCsv(`search=${encodeURIComponent("محمد")}`)).rows.map((r) => r["Order ID"])).toEqual([ids.multi]);
    expect((await exportCsv("search=%23a1b2c3d4")).rows.map((r) => r["Order ID"])).toEqual([ids.single]);
    expect((await exportCsv("search=filler%201199")).rows).toHaveLength(1);
    const creatine = await exportCsv("search=creatine");
    expect(creatine.rows.map((r) => r["Order ID"]).sort()).toEqual(
      [ids.multi, ids.online, ids.issue].sort(),
    );
    // LIKE wildcards are literal text.
    expect((await exportCsv("search=%25")).rows).toHaveLength(0);
    expect((await exportCsv("search=_")).rows).toHaveLength(0);
  });

  it("returns a header-only file when nothing matches", async () => {
    const { res, rows, header } = await exportCsv("dateFrom=2030-01-01T00:00:00.000Z");
    expect(res.statusCode).toBe(200);
    expect(header.length).toBeGreaterThan(10);
    expect(rows).toHaveLength(0);
    expect(res.headers[ORDERS_EXPORT_COUNT_HEADER]).toBe("0");
  });

  it("refuses non-admins against the real database", async () => {
    const res = await app.inject({ method: "GET", url: ORDERS_EXPORT_ENDPOINT, headers: { "x-test-role": "user" } });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("Filler");
    const anon = await app.inject({ method: "GET", url: ORDERS_EXPORT_ENDPOINT });
    expect(anon.statusCode).toBe(401);
  });
});
