import { describe, expect, it } from "vitest";
import {
  classifyOrder,
  formatCents,
  sumTotals,
  toCents,
  toOrderRow,
  type PromoOrderFacts,
} from "../classify";
import { PROMO_BUCKETS } from "#root/shared/promo-performance/report";

function facts(over: Partial<PromoOrderFacts> = {}): PromoOrderFacts {
  return {
    id: "0192f000-0000-7000-8000-00000000abcd",
    reference: "ORD-0000ABCD",
    createdAt: new Date("2026-10-10T10:00:00Z"),
    status: "delivered",
    paymentMethod: "cod",
    paymentStatus: "not_required",
    subtotal: "1000.00",
    discount: "100.00",
    shipping: "60.00",
    tax: "0.00",
    total: "960.00",
    linkedCode: "AHMED10",
    attemptCode: null,
    attempt: null,
    bostaStatus: "Delivered",
    bostaStatusCode: "45",
    returnLogged: false,
    adminEdited: false,
    onHold: false,
    archived: false,
    ...over,
  };
}

describe("money", () => {
  it("parses stored decimals exactly", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("0.10")).toBe(10);
    expect(toCents("7.5")).toBe(750);
    expect(toCents("12")).toBe(1200);
    expect(toCents("-3.05")).toBe(-305);
    expect(toCents(null)).toBe(0);
  });

  it("rejects anything that isn't a plain decimal", () => {
    for (const bad of ["1e3", "12.345", "abc", "", "1,000.00", "NaN"]) {
      expect(() => toCents(bad)).toThrow();
    }
  });

  it("formats cents back", () => {
    expect(formatCents(123456)).toBe("1234.56");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-305)).toBe("-3.05");
    expect(formatCents(0)).toBe("0.00");
  });

  it("adds without float drift", () => {
    const orders = Array.from({ length: 10 }, (_, i) =>
      classifyOrder(facts({ id: `id-${i}`, subtotal: "0.10", discount: "0.00", shipping: "0.20", total: "0.30" })),
    );
    // 10 × 0.1 in floats is 0.9999999999999999.
    expect(sumTotals(orders).grossSales).toBe("1.00");
  });
});

describe("commission eligibility", () => {
  it("COD delivered and not refunded is eligible for subtotal − discount", () => {
    const o = classifyOrder(facts());
    expect(o.bucket).toBe("eligible");
    expect(o.financialStatus).toBe("verified");
    expect(toOrderRow(o).eligibleAmount).toBe("900.00");
  });

  it("excludes shipping and tax from the commission base", () => {
    const o = classifyOrder(facts({ shipping: "75.00", tax: "14.00", total: "989.00" }));
    expect(o.bucket).toBe("eligible");
    expect(toOrderRow(o).eligibleAmount).toBe("900.00");
  });

  it("online delivered and paid is eligible", () => {
    const o = classifyOrder(facts({ paymentMethod: "fawaterak", paymentStatus: "paid" }));
    expect(o.bucket).toBe("eligible");
  });

  it("online delivered but not paid needs review, not eligible", () => {
    const o = classifyOrder(facts({ paymentMethod: "fawaterak", paymentStatus: "pending" }));
    expect(o.bucket).toBe("review");
    expect(o.reasons).toContain("online_not_paid");
    expect(toOrderRow(o).eligibleAmount).toBe("0.00");
    expect(toOrderRow(o).reviewAmount).toBe("900.00");
  });

  it("COD delivered with a failed payment needs review", () => {
    const o = classifyOrder(facts({ paymentStatus: "failed" }));
    expect(o.bucket).toBe("review");
    expect(o.reasons).toEqual(["payment_failed"]);
  });

  it.each(["pending", "processing", "shipped"] as const)("%s is not yet eligible", (status) => {
    const o = classifyOrder(facts({ status, bostaStatusCode: null }));
    expect(o.bucket).toBe("in_progress");
    expect(o.financialStatus).toBe("not_payable");
    expect(toOrderRow(o).eligibleAmount).toBe("0.00");
  });

  it("an online paid order that hasn't been delivered is not eligible", () => {
    const o = classifyOrder(facts({ status: "processing", paymentMethod: "fawaterak", paymentStatus: "paid" }));
    expect(o.bucket).toBe("in_progress");
  });

  it("cancelled is excluded", () => {
    const o = classifyOrder(facts({ status: "cancelled", bostaStatusCode: "49" }));
    expect(o.bucket).toBe("cancelled");
    expect(o.financialStatus).toBe("not_payable");
  });

  it("a Bosta return (code 46) is reported as returned", () => {
    const o = classifyOrder(facts({ status: "cancelled", bostaStatusCode: "46", bostaStatus: "Returned to business" }));
    expect(o.bucket).toBe("returned");
  });

  it("a logged return is still a return after Bosta moves on to another state", () => {
    const o = classifyOrder(facts({ status: "cancelled", bostaStatusCode: "104", returnLogged: true }));
    expect(o.bucket).toBe("returned");
  });

  it("a return on an order marked delivered is flagged, not paid", () => {
    const o = classifyOrder(facts({ status: "delivered", returnLogged: true }));
    expect(o.bucket).toBe("review");
    expect(o.reasons).toContain("return_status_conflict");
  });

  it("refunded is excluded and flagged because the refund amount is unknown", () => {
    const o = classifyOrder(facts({ paymentMethod: "fawaterak", paymentStatus: "refunded" }));
    expect(o.bucket).toBe("refunded");
    expect(o.financialStatus).toBe("needs_review");
    expect(o.reasons).toEqual(["refund_amount_unknown"]);
    expect(toOrderRow(o).eligibleAmount).toBe("0.00");
    expect(toOrderRow(o).reviewAmount).toBe("0.00");
  });

  it("held or archived delivered orders need review", () => {
    expect(classifyOrder(facts({ onHold: true })).reasons).toEqual(["on_hold"]);
    expect(classifyOrder(facts({ archived: true })).reasons).toEqual(["archived"]);
  });
});

describe("financial reliability", () => {
  it("an admin-edited COD order needs review", () => {
    const o = classifyOrder(facts({ adminEdited: true }));
    expect(o.bucket).toBe("review");
    expect(o.reasons).toEqual(["admin_edited"]);
  });

  it("an admin-edited online order whose amounts still match the payment record stays verified", () => {
    const o = classifyOrder(
      facts({
        paymentMethod: "fawaterak",
        paymentStatus: "paid",
        adminEdited: true,
        attemptCode: "AHMED10",
        attempt: { subtotal: "1000.00", discount: "100.00", promoDiscount: "100.00", offerDiscount: "0.00", total: "960.00" },
      }),
    );
    expect(o.bucket).toBe("eligible");
  });

  it("an admin edit that changed an online order's amounts needs review", () => {
    const o = classifyOrder(
      facts({
        paymentMethod: "fawaterak",
        paymentStatus: "paid",
        adminEdited: true,
        discount: "150.00",
        total: "910.00",
        attempt: { subtotal: "1000.00", discount: "100.00", promoDiscount: "100.00", offerDiscount: "0.00", total: "960.00" },
      }),
    );
    expect(o.bucket).toBe("review");
    expect(o.promoOnlyDiscount).toBeNull();
  });

  it("a hand-set total is flagged", () => {
    const o = classifyOrder(facts({ total: "500.00" }));
    expect(o.reasons).toContain("total_mismatch");
    expect(o.bucket).toBe("review");
  });

  it("tolerates one piastre of per-column rounding in the total", () => {
    expect(classifyOrder(facts({ total: "960.01" })).reasons).toEqual([]);
    expect(classifyOrder(facts({ total: "960.02" })).reasons).toContain("total_mismatch");
  });

  it("a discount larger than the subtotal is flagged", () => {
    const o = classifyOrder(facts({ subtotal: "100.00", discount: "150.00", total: "60.00" }));
    expect(o.reasons).toEqual(["negative_net"]);
  });
});

describe("discounts", () => {
  it("does not label a combined COD discount as promo-only", () => {
    const o = classifyOrder(facts());
    expect(o.promoOnlyDiscount).toBeNull();
    expect(toOrderRow(o).discount).toBe("100.00");
  });

  it("uses the payment record's promo/offer split when it is intact", () => {
    const o = classifyOrder(
      facts({
        paymentMethod: "fawaterak",
        paymentStatus: "paid",
        discount: "150.00",
        total: "910.00",
        attempt: { subtotal: "1000.00", discount: "150.00", promoDiscount: "90.00", offerDiscount: "60.00", total: "910.00" },
      }),
    );
    expect(o.promoOnlyDiscount).toBe(9000);
    expect(o.offerDiscount).toBe(6000);
    // The commission base subtracts the combined discount once — not again.
    expect(o.net).toBe(85000);
  });

  it("a split that doesn't add up to the stored discount is not trusted", () => {
    const o = classifyOrder(
      facts({
        paymentMethod: "fawaterak",
        paymentStatus: "paid",
        attempt: { subtotal: "1000.00", discount: "100.00", promoDiscount: "99.00", offerDiscount: "0.00", total: "960.00" },
      }),
    );
    expect(o.promoOnlyDiscount).toBeNull();
  });

  it("no discount at all means a known promo-only discount of zero", () => {
    const o = classifyOrder(facts({ discount: null, total: "1060.00" }));
    expect(o.promoOnlyDiscount).toBe(0);
  });
});

describe("attribution", () => {
  it("prefers the order's promo link", () => {
    const o = classifyOrder(facts({ linkedCode: "AHMED10", attemptCode: "AHMED10" }));
    expect(o.code).toBe("AHMED10");
    expect(o.attribution).toBe("promo_link");
  });

  it("recovers a deleted code from the payment record", () => {
    const o = classifyOrder(facts({ linkedCode: null, attemptCode: "OLDCODE" }));
    expect(o.code).toBe("OLDCODE");
    expect(o.attribution).toBe("payment_record");
  });

  it("leaves a discount with no code unattributed", () => {
    const o = classifyOrder(facts({ linkedCode: null, attemptCode: null }));
    expect(o.code).toBeNull();
    expect(o.attribution).toBe("none");
  });
});

describe("totals", () => {
  const sample = [
    facts({ id: "a" }),
    facts({ id: "b", status: "pending", bostaStatusCode: null }),
    facts({ id: "c", status: "cancelled" }),
    facts({ id: "d", status: "cancelled", bostaStatusCode: "46" }),
    facts({ id: "e", paymentMethod: "fawaterak", paymentStatus: "refunded" }),
    facts({ id: "f", adminEdited: true, subtotal: "333.33", discount: "33.33", total: "360.00" }),
    facts({ id: "g", linkedCode: null, attemptCode: "OLD" }),
  ].map(classifyOrder);

  it("buckets add up to net sales exactly", () => {
    const t = sumTotals(sample);
    const bucketSum = PROMO_BUCKETS.reduce((s, b) => s + toCents(t.buckets[b].amount), 0);
    expect(bucketSum).toBe(toCents(t.netSales));
    expect(PROMO_BUCKETS.reduce((s, b) => s + t.buckets[b].orders, 0)).toBe(t.orders);
    expect(toCents(t.grossSales) - toCents(t.totalDiscounts)).toBe(toCents(t.netSales));
  });

  it("counts each bucket and flag", () => {
    const t = sumTotals(sample);
    expect(t.orders).toBe(7);
    expect(t.buckets.eligible).toEqual({ orders: 2, amount: "1800.00" });
    expect(t.buckets.review).toEqual({ orders: 1, amount: "300.00" });
    expect(t.buckets.in_progress.orders).toBe(1);
    expect(t.buckets.cancelled.orders).toBe(1);
    expect(t.buckets.returned.orders).toBe(1);
    expect(t.buckets.refunded.orders).toBe(1);
    expect(t.flaggedOrders).toBe(2);
    expect(t.recoveredOrders).toBe(1);
    expect(t.promoOnlyKnownOrders).toBe(0);
  });

  it("holds the invariant for arbitrary orders", () => {
    const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"] as const;
    const payments = ["not_required", "pending", "paid", "failed", "refunded"];
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const orders = Array.from({ length: 500 }, (_, i) => {
      const subtotal = rand(500000);
      const discount = rand(subtotal + 1);
      const shipping = rand(10000);
      return classifyOrder(
        facts({
          id: `r${i}`,
          status: statuses[rand(5)]!,
          paymentMethod: rand(2) ? "cod" : "fawaterak",
          paymentStatus: payments[rand(5)]!,
          subtotal: formatCents(subtotal),
          discount: formatCents(discount),
          shipping: formatCents(shipping),
          total: formatCents(subtotal - discount + shipping + (rand(10) === 0 ? 500 : 0)),
          bostaStatusCode: rand(8) === 0 ? "46" : null,
          adminEdited: rand(6) === 0,
        }),
      );
    });
    const t = sumTotals(orders);
    const net = orders.reduce((s, o) => s + o.net, 0);
    expect(toCents(t.netSales)).toBe(net);
    expect(PROMO_BUCKETS.reduce((s, b) => s + toCents(t.buckets[b].amount), 0)).toBe(net);
    // Nothing uncertain is ever counted as eligible.
    for (const o of orders) {
      if (o.bucket === "eligible") expect(o.reasons).toEqual([]);
      if (o.reasons.length > 0) expect(o.bucket).not.toBe("eligible");
    }
  });
});
