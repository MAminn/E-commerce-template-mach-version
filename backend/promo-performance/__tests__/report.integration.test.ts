import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { PROMO_BUCKETS, type PromoTotals } from "#root/shared/promo-performance/report";
import { formatCents, toCents } from "../classify";

// Real-Postgres integration test for the Promo Performance report — see
// docs/MARKETING_SUITE_PLAN.md "Running the DB integration tests". Seeds
// historical orders the way checkout, Bosta, the admin edit panel and online
// payments leave them, then checks the report, its drill-down, the
// independent SQL in docs/promo-performance/verify-production.readonly.sql,
// that nothing was written, and the query time at volume.

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };
const FILLER = 60;

describeIfDb("promo performance report (integration)", () => {
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
  };
  let service: typeof import("../service");
  let v7: () => string;

  const promoIds: Record<string, string> = {};

  async function fingerprint(): Promise<string> {
    const result = await db.execute(
      sql`select md5(coalesce(string_agg(t, '|' order by t), '')) as h from (
            select o::text as t from "order" o
            union all select a::text from payment_attempt a
            union all select p::text from promo_code p
            union all select l::text from order_log l) s`,
    );
    return (result.rows[0] as { h: string }).h;
  }

  type OrderSeed = Partial<typeof schema.order.$inferInsert> & { code?: string | null };

  async function seedOrder(seed: OrderSeed): Promise<string> {
    const id = seed.id ?? v7();
    const { code, ...rest } = seed;
    await db.insert(schema.order).values({
      customerName: "Test Customer",
      customerEmail: "c@example.com",
      customerPhone: "01000000000",
      shippingAddress: "1 Test St",
      shippingCity: "Nasr City",
      shippingState: "Cairo",
      shippingPostalCode: "",
      shippingCountry: "Egypt",
      subtotal: "1000.00",
      discount: "100.00",
      shipping: "60.00",
      tax: "0.00",
      total: "960.00",
      status: "delivered",
      paymentMethod: "cod",
      paymentStatus: "not_required",
      createdAt: new Date("2026-10-15T10:00:00Z"),
      promoCodeId: code === undefined ? promoIds.AHMED10 : code === null ? null : promoIds[code],
      ...rest,
      id,
    });
    return id;
  }

  async function seedAttempt(orderId: string, over: Partial<typeof schema.paymentAttempt.$inferInsert>) {
    await db.insert(schema.paymentAttempt).values({
      id: orderId,
      orderId,
      provider: "fawaterak",
      status: "materialized",
      fingerprint: `fp-${orderId}`,
      customerName: "Test Customer",
      customerEmail: "c@example.com",
      customerPhone: "01000000000",
      orderSnapshot: {} as never,
      itemsSnapshot: [] as never,
      subtotal: "1000.00",
      offerDiscount: "0.00",
      promoDiscount: "100.00",
      discount: "100.00",
      shipping: "60.00",
      tax: "0.00",
      total: "960.00",
      ...over,
    });
  }

  async function log(orderId: string, action: "bosta_status_updated" | "items_edited", note: string) {
    await db.insert(schema.orderLog).values({ orderId, action, note, oldStatus: "x", newStatus: "y" });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    db = drizzle(TEST_DB_URL!, { schema });
    service = await import("../service");
    v7 = (await import("uuid")).v7;

    await db.execute(
      sql`truncate order_log, order_item, payment_attempt, order_reference, "order", promo_code, cart_offer cascade`,
    );

    for (const [code, type, value] of [
      ["AHMED10", "percentage", "10.00"],
      ["SARA50", "fixed_amount", "50.00"],
      ["ZERO", "percentage", "5.00"],
    ] as const) {
      promoIds[code] = v7();
      await db.insert(schema.promoCode).values({
        id: promoIds[code],
        code,
        description: `${code} influencer`,
        discountType: type,
        discountValue: value,
        status: "active",
        usedCount: 999, // never used by the report
      });
    }

    // ── AHMED10, October ────────────────────────────────────────────────
    await seedOrder({ reference: "ORD-ELIGCOD1" }); // eligible 900
    await seedOrder({ status: "pending" }); // in progress
    await seedOrder({ status: "shipped", bostaStatusCode: "41" }); // in progress
    await seedOrder({ status: "cancelled", bostaStatusCode: "49" }); // cancelled
    await seedOrder({ status: "cancelled", bostaStatusCode: "46", bostaStatus: "Returned to business" }); // returned
    const returnedThenArchived = await seedOrder({ status: "cancelled", bostaStatusCode: "104", bostaStatus: "Archived" });
    await log(returnedThenArchived, "bosta_status_updated", 'Bosta reported "Returned to business" (code 46)');
    await seedOrder({ paymentMethod: "fawaterak", paymentStatus: "refunded" }); // refunded
    const onlinePaid = await seedOrder({ paymentMethod: "fawaterak", paymentStatus: "paid" });
    await seedAttempt(onlinePaid, { promoCodeId: promoIds.AHMED10, promoCode: "AHMED10" }); // eligible, promo-only 100
    await seedOrder({ paymentMethod: "fawaterak", paymentStatus: "pending" }); // review: delivered, unpaid
    const editedCod = await seedOrder({ discount: "200.00", total: "860.00" });
    await log(editedCod, "items_edited", "Order edited by admin"); // review 800
    const editedOnline = await seedOrder({ paymentMethod: "fawaterak", paymentStatus: "paid" });
    await seedAttempt(editedOnline, { promoCodeId: promoIds.AHMED10, promoCode: "AHMED10" });
    await log(editedOnline, "items_edited", "Order edited by admin"); // amounts intact → eligible
    await seedOrder({ discount: "150.00", total: "910.00" }); // promo + offer combined → eligible 850
    await seedOrder({ total: "500.00" }); // hand-set total → review
    // Cairo month edges: EEST (UTC+3) on 1 Oct, EET (UTC+2) on 31 Oct.
    await seedOrder({ createdAt: new Date("2026-09-30T21:00:00.000Z") }); // 1 Oct 00:00 Cairo — in
    await seedOrder({ createdAt: new Date("2026-09-30T20:59:59.999Z") }); // 30 Sep — out
    await seedOrder({ createdAt: new Date("2026-10-31T21:59:59.999Z") }); // 31 Oct 23:59 Cairo — in
    await seedOrder({ createdAt: new Date("2026-10-31T22:00:00.000Z") }); // 1 Nov — out
    for (let i = 0; i < FILLER; i++) {
      await seedOrder({
        subtotal: `${100 + i}.00`,
        discount: "10.00",
        total: `${150 + i}.00`,
        createdAt: new Date(Date.UTC(2026, 9, 2, 0, i)),
      });
    }

    // ── SARA50 ──────────────────────────────────────────────────────────
    await seedOrder({ code: "SARA50", discount: "50.00", total: "1010.00" }); // eligible 950
    await seedOrder({ code: "SARA50", discount: "50.00", total: "1010.00", status: "cancelled" });

    // ── OLDCODE: deleted promo; only the payment attempt kept its text ───
    const recovered = await seedOrder({ code: null, paymentMethod: "fawaterak", paymentStatus: "paid" });
    await seedAttempt(recovered, { promoCodeId: null, promoCode: "OLDCODE" });

    // ── No code, but discounted (automatic offer or deleted COD code) ────
    await seedOrder({ code: null, discount: "80.00", total: "980.00" });
    // ── No code, no discount: not part of the report ─────────────────────
    await seedOrder({ code: null, discount: null, total: "1060.00" });
  });

  afterAll(async () => {
    if (!db) return;
    // Leave the shared test database as empty as we found it for the next file.
    await db.execute(
      sql`truncate order_log, order_item, payment_attempt, order_reference, "order", promo_code, cart_offer cascade`,
    );
    await db.$client.end();
  });

  const summaryRow = async (range: { from?: string; to?: string }, code: string) =>
    (await service.getPromoPerformanceSummary(db as never, range)).rows.find((r) => r.code === code);

  it("reports AHMED10's October money exactly", async () => {
    const row = await summaryRow(OCTOBER, "AHMED10");
    const fillerNet = FILLER * 90 + (FILLER * (FILLER - 1)) / 2; // Σ (90 + i)
    expect(row).toMatchObject({
      orders: 15 + FILLER,
      promoOnlyDiscounts: "200.00",
      promoOnlyKnownOrders: 2,
      flaggedOrders: 4,
      codeExists: true,
      description: "AHMED10 influencer",
    });
    expect(row!.buckets).toEqual({
      eligible: { orders: 6 + FILLER, amount: formatCents((900 * 5 + 850 + fillerNet) * 100) },
      review: { orders: 3, amount: "2600.00" },
      in_progress: { orders: 2, amount: "1800.00" },
      cancelled: { orders: 1, amount: "900.00" },
      returned: { orders: 2, amount: "1800.00" },
      refunded: { orders: 1, amount: "900.00" },
    });
    const bucketSum = PROMO_BUCKETS.reduce((s, b) => s + toCents(row!.buckets[b].amount), 0);
    expect(bucketSum).toBe(toCents(row!.netSales));
    expect(toCents(row!.grossSales) - toCents(row!.totalDiscounts)).toBe(toCents(row!.netSales));
  });

  it("covers multiple codes, deleted codes, unattributed discounts and codes without orders", async () => {
    const summary = await service.getPromoPerformanceSummary(db as never, OCTOBER);
    const sara = summary.rows.find((r) => r.code === "SARA50")!;
    expect(sara.buckets.eligible).toEqual({ orders: 1, amount: "950.00" });
    expect(sara.buckets.cancelled).toEqual({ orders: 1, amount: "950.00" });

    const old = summary.rows.find((r) => r.code === "OLDCODE")!;
    expect(old).toMatchObject({ codeExists: false, recoveredOrders: 1, orders: 1 });
    expect(old.buckets.eligible.amount).toBe("900.00");
    expect(old.promoOnlyDiscounts).toBe("100.00");

    expect(summary.rows.find((r) => r.code === "ZERO")).toMatchObject({ orders: 0, netSales: "0.00" });
    expect(summary.unattributed).toMatchObject({ orders: 1, netSales: "920.00" });

    // Highest net first; the "All codes" line is the exact sum of the rows.
    expect(summary.rows[0]!.code).toBe("AHMED10");
    const sumOf = (pick: (t: PromoTotals) => string) =>
      formatCents(summary.rows.reduce((s, r) => s + toCents(pick(r)), 0));
    expect(summary.attributedTotals.netSales).toBe(sumOf((t) => t.netSales));
    expect(summary.attributedTotals.buckets.eligible.amount).toBe(sumOf((t) => t.buckets.eligible.amount));
    expect(summary.attributedTotals.orders).toBe(summary.rows.reduce((s, r) => s + r.orders, 0));
  });

  it("uses Cairo day boundaries across the DST change", async () => {
    expect((await summaryRow({ from: "2026-09-01", to: "2026-09-30" }, "AHMED10"))!.orders).toBe(1);
    expect((await summaryRow({ from: "2026-11-01", to: "2026-11-30" }, "AHMED10"))!.orders).toBe(1);
    expect((await summaryRow({ from: "2026-10-01", to: "2026-10-01" }, "AHMED10"))!.orders).toBe(1);
    expect((await summaryRow({ from: "2026-10-31", to: "2026-10-31" }, "AHMED10"))!.orders).toBe(1);
    expect((await summaryRow({}, "AHMED10"))!.orders).toBe(17 + FILLER);
    expect((await summaryRow({ from: "2026-10-01" }, "AHMED10"))!.orders).toBe(16 + FILLER);
  });

  it("drill-down pages reconcile exactly with the summary row", async () => {
    const row = (await summaryRow(OCTOBER, "AHMED10"))!;
    const seen = new Map<string, { net: string; eligibleAmount: string; reviewAmount: string }>();
    let totals: PromoTotals | null = null;
    for (let offset = 0; ; offset += 25) {
      const page = await service.getPromoOrders(db as never, {
        range: OCTOBER,
        code: "AHMED10",
        limit: 25,
        offset,
      });
      totals = page.totals;
      for (const r of page.rows) seen.set(r.id, r);
      if (page.rows.length < 25) break;
    }
    const { code: _c, codeExists: _e, description: _d, ...rowTotals } = row;
    expect(totals).toEqual(rowTotals);
    expect(seen.size).toBe(row.orders); // every order exactly once
    const sum = (k: "net" | "eligibleAmount" | "reviewAmount") =>
      formatCents([...seen.values()].reduce((s, r) => s + toCents(r[k]), 0));
    expect(sum("net")).toBe(row.netSales);
    expect(sum("eligibleAmount")).toBe(row.buckets.eligible.amount);
    expect(sum("reviewAmount")).toBe(row.buckets.review.amount);
  });

  it("drill-down filters by bucket and explains each flag", async () => {
    const page = await service.getPromoOrders(db as never, {
      range: OCTOBER,
      code: "AHMED10",
      bucket: "review",
      limit: 25,
      offset: 0,
    });
    expect(page.filteredCount).toBe(3);
    expect(page.totals.orders).toBe(15 + FILLER);
    expect(page.rows.map((r) => r.reasons).sort()).toEqual(
      [["admin_edited"], ["online_not_paid"], ["total_mismatch"]].sort(),
    );
    expect(page.rows.every((r) => r.eligibleAmount === "0.00" && r.financialStatus === "needs_review")).toBe(true);

    const eligible = await service.getPromoOrders(db as never, {
      range: OCTOBER,
      code: "AHMED10",
      bucket: "eligible",
      limit: 100,
      offset: 0,
    });
    expect(eligible.rows.find((r) => r.reference === "ORD-ELIGCOD1")).toMatchObject({
      eligibleAmount: "900.00",
      promoOnlyDiscount: null, // COD: promo and offers are stored combined
      financialStatus: "verified",
    });

    const unattributed = await service.getPromoOrders(db as never, {
      range: OCTOBER,
      code: null,
      limit: 25,
      offset: 0,
    });
    expect(unattributed.rows).toHaveLength(1);
    expect(unattributed.rows[0]).toMatchObject({ attribution: "none", discount: "80.00", net: "920.00" });
  });

  it("the independent verification SQL produces the same figures", async () => {
    const file = readFileSync(
      path.resolve(__dirname, "../../../docs/promo-performance/verify-production.readonly.sql"),
      "utf8",
    );
    const results = (await db.$client.query(file)) as unknown as Array<{ command: string; rows: Record<string, string>[] }>;
    const q1 = results.find((r) => r.command === "SELECT")!.rows;
    const summary = await service.getPromoPerformanceSummary(db as never, OCTOBER);
    const expected = [
      ...summary.rows.filter((r) => r.orders > 0).map((r) => ({ code: r.code, t: r as PromoTotals })),
      { code: "(unattributed)", t: summary.unattributed },
    ].sort((a, b) => (a.code < b.code ? -1 : 1));

    const money = (v: string) => formatCents(toCents(v));
    expect(
      q1.map((r) => ({
        code: r.code,
        orders: Number(r.orders),
        gross: money(r.gross_sales!),
        discounts: money(r.total_discounts!),
        promoOnly: money(r.promo_only_discounts!),
        promoOnlyOrders: Number(r.promo_only_known_orders),
        net: money(r.net_sales!),
        buckets: Object.fromEntries(
          PROMO_BUCKETS.map((b) => [b, { orders: Number(r[`${b}_orders`]), amount: money(r[`${b}_amount`]!) }]),
        ),
      })),
    ).toEqual(
      expected.map(({ code, t }) => ({
        code,
        orders: t.orders,
        gross: t.grossSales,
        discounts: t.totalDiscounts,
        promoOnly: t.promoOnlyDiscounts,
        promoOnlyOrders: t.promoOnlyKnownOrders,
        net: t.netSales,
        buckets: t.buckets,
      })),
    );
  });

  it("writes nothing", async () => {
    const before = await fingerprint();
    const range = { from: "2026-10-01", to: "2026-10-31" };
    await service.getPromoPerformanceSummary(db as never, range);
    await service.getPromoOrders(db as never, { range, code: "AHMED10", limit: 100, offset: 0 });
    await db.$client.query(
      readFileSync(path.resolve(__dirname, "../../../docs/promo-performance/verify-production.readonly.sql"), "utf8"),
    );
    expect(await fingerprint()).toBe(before);
  });

  it("stays fast on a large history", async () => {
    // 60k orders (a third with a code) and 120k log rows, generated in SQL.
    await db.execute(sql`
      insert into "order" (id, customer_name, customer_email, customer_phone, shipping_address,
        shipping_city, shipping_state, shipping_postal_code, shipping_country,
        subtotal, discount, shipping, tax, total, status, payment_method, payment_status,
        promo_code_id, created_at)
      select gen_random_uuid(), 'Bulk', 'b@example.com', '0100', 'x', 'x', 'x', '', 'Egypt',
        500, 50, 60, 0, 510,
        (array['pending','processing','shipped','delivered','delivered','delivered','cancelled'])[1 + g % 7]::order_status,
        'cod'::payment_method, 'not_required'::payment_status,
        case when g % 3 = 0 then ${promoIds.SARA50}::uuid end,
        timestamptz '2025-11-01' + (g || ' minutes')::interval * 8
      from generate_series(1, 60000) g`);
    await db.execute(sql`
      insert into order_log (id, order_id, action, note)
      select gen_random_uuid(), id, 'status_changed'::order_log_action, 'Status changed'
      from "order" o cross join generate_series(1, 2)
      where o.customer_name = 'Bulk'`);

    const time = async <T>(fn: () => Promise<T>) => {
      const start = performance.now();
      const result = await fn();
      return { result, ms: Math.round(performance.now() - start) };
    };
    const month = await time(() => service.getPromoPerformanceSummary(db as never, { from: "2026-03-01", to: "2026-03-31" }));
    const drill = await time(() =>
      service.getPromoOrders(db as never, {
        range: { from: "2026-03-01", to: "2026-03-31" },
        code: "SARA50",
        limit: 25,
        offset: 500,
      }),
    );
    console.info(
      `[promo report timing] bounded month summary ${month.ms}ms, ` +
        `bounded month drill-down page ${drill.ms}ms (${drill.result.totals.orders} orders)`,
    );
    expect(month.result.rows.find((r) => r.code === "SARA50")!.orders).toBeGreaterThan(0);
    expect(month.ms).toBeLessThan(2000);
    expect(drill.ms).toBeLessThan(2000);
  });
});
