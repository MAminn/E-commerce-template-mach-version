import { describe, expect, it } from "vitest";
import { v7 } from "uuid";
import {
  buildOrderReference,
  displayOrderNumber,
  legacyOrderReference,
  matchesOrderReference,
  ORDER_REFERENCE_PATTERN,
  resolveOrderReference,
} from "#root/shared/orders/order-reference";
import { buildFawaterakTransactionPayload } from "#root/backend/payments/fawaterak-service";
import {
  paidOnHoldAdminNotice,
  paidUnderReviewCustomerNotice,
} from "#root/backend/emails/order-email-notice";

/**
 * Unique order / Fawaterak references. The database registry (order_reference
 * primary key) is what enforces uniqueness — exercised against Postgres in
 * payment-attempt-flow.integration.test.ts (REF-1…REF-4). These tests pin the
 * format and the legacy compatibility.
 */

describe("order references", () => {
  it("keeps the exact accepted Fawaterak format: ORD- + 8 uppercase hex", () => {
    for (let i = 0; i < 50; i++) {
      expect(buildOrderReference(v7())).toMatch(ORDER_REFERENCE_PATTERN);
    }
    expect("ORD-01A1156B".length).toBe(buildOrderReference(v7()).length);
  });

  it("is a pure function of the id (an attempt's order reuses the attempt id → same reference)", () => {
    const id = v7();
    expect(buildOrderReference(id)).toBe(buildOrderReference(id));
  });

  it("ids created in the same burst: the legacy timestamp prefix collides, the new reference does not", () => {
    const ids = Array.from({ length: 200 }, () => v7());
    const legacy = new Set(ids.map(legacyOrderReference));
    const fresh = new Set(ids.map(buildOrderReference));
    expect(legacy.size).toBeLessThan(10); // the bug: same number for many orders
    expect(fresh.size).toBe(200);
  });

  it("legacy rows (no stored reference) keep the number they always showed", () => {
    const id = "01a1156a-efe8-7220-be77-c9351f28c215";
    expect(resolveOrderReference({ id, reference: null })).toBe("ORD-01A1156A");
    expect(displayOrderNumber({ id })).toBe("#01A1156A");
  });

  it("new rows display their stored unique reference", () => {
    const id = "01a1156a-efe8-7220-be77-c9351f28c215";
    expect(displayOrderNumber({ id, reference: "ORD-1F28C215" })).toBe("#1F28C215");
  });

  it("admin search matches '#XXXX', 'ORD-XXXX', partial and lowercase input", () => {
    const row = { id: "01a1156a-efe8-7220-be77-c9351f28c215", reference: "ORD-1F28C215" };
    for (const q of ["#1F28C215", "ORD-1F28C215", "1f28", "ord-1f28c215"]) {
      expect(matchesOrderReference(row, q)).toBe(true);
    }
    expect(matchesOrderReference(row, "01A1156A")).toBe(false);
    expect(matchesOrderReference({ id: row.id, reference: null }, "#01a1156a")).toBe(true);
  });
});

describe("Fawaterak tr_number", () => {
  const base = {
    orderId: "01a1156a-efe8-7220-be77-c9351f28c215",
    customerName: "A B",
    customerEmail: "a@b.c",
    customerPhone: "010",
    total: "150.00",
  };

  it("new attempts send their registered unique reference", () => {
    const payload = buildFawaterakTransactionPayload({ ...base, referenceKind: "attempt", reference: "ORD-1F28C215" });
    expect(payload.tr_number).toBe("ORD-1F28C215");
    expect(payload.pay_load).toEqual({ orderId: base.orderId });
  });

  it("legacy order-first payments keep the original derivation unchanged", () => {
    const payload = buildFawaterakTransactionPayload(base);
    expect(payload.tr_number).toBe("ORD-01A1156A");
  });
});

describe("paid-but-held email copy", () => {
  it("customer: payment received, under review, availability — no fulfillment promises", () => {
    const notice = paidUnderReviewCustomerNotice("#1F28C215");
    const text = [notice.title, notice.preview, ...notice.paragraphs].join(" ");
    expect(text).toContain("Payment received.");
    expect(text).toContain("Your order is currently under review.");
    expect(text).toContain("We'll contact you shortly regarding availability.");
    expect(text).not.toMatch(/ship|prepar|processing|fulfil|on its way/i);
    expect(notice.alert).toBeUndefined();
  });

  it("admin: the hold is unmistakable", () => {
    const notice = paidOnHoldAdminNotice("#1F28C215", "requested 3, available 1");
    expect(notice.alert).toEqual([
      "PAID — STOCK ISSUE",
      "DO NOT PREPARE · MANUAL REVIEW REQUIRED",
      "requested 3, available 1",
    ]);
    expect(notice.preview).toMatch(/DO NOT PREPARE/);
  });
});
