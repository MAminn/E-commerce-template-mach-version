import { describe, expect, it } from "vitest";
import {
  VALU_INSTALLMENTS_COPY,
  VALU_INSTALLMENTS_METHOD_ID,
  estimateMonthlyInstallment,
  isValuInstallmentsAvailable,
  resolveCheckoutPaymentMethod,
} from "../valu-installments";
import { PAYMENT_METHODS } from "../payment-methods";

describe("estimateMonthlyInstallment", () => {
  it("EGP 1,389 → EGP 463.00 / month over 3 months", () => {
    expect(estimateMonthlyInstallment(1389)).toBe(463);
    expect(estimateMonthlyInstallment(1389)?.toFixed(2)).toBe("463.00");
  });

  it("rounds to 2 decimals (half up on piasters)", () => {
    expect(estimateMonthlyInstallment(100)).toBe(33.33);
    expect(estimateMonthlyInstallment(200)).toBe(66.67);
    expect(estimateMonthlyInstallment(2693)).toBe(897.67);
    expect(estimateMonthlyInstallment(0.05)).toBe(0.02); // 5 / 3 = 1.67 → 2 piasters
  });

  it("is immune to float subtraction noise in the total", () => {
    // e.g. subtotal − discount + shipping landing a hair under 1389
    expect(estimateMonthlyInstallment(1388.9999999999998)).toBe(463);
    expect(estimateMonthlyInstallment(0.1 + 0.2)).toBe(0.1);
  });

  it("returns null when there is nothing to estimate", () => {
    expect(estimateMonthlyInstallment(0)).toBeNull();
    expect(estimateMonthlyInstallment(-5)).toBeNull();
    expect(estimateMonthlyInstallment(Number.NaN)).toBeNull();
    expect(estimateMonthlyInstallment(Number.POSITIVE_INFINITY)).toBeNull();
    expect(estimateMonthlyInstallment(100, 0)).toBeNull();
  });
});

describe("resolveCheckoutPaymentMethod", () => {
  it("submits valU as the existing Fawaterak gateway", () => {
    expect(resolveCheckoutPaymentMethod(VALU_INSTALLMENTS_METHOD_ID)).toBe("fawaterak");
  });

  it("passes every real payment method through unchanged", () => {
    for (const m of PAYMENT_METHODS) expect(resolveCheckoutPaymentMethod(m)).toBe(m);
  });

  it("valu_installments is a UI value, never a gateway / DB enum value", () => {
    expect(VALU_INSTALLMENTS_METHOD_ID).toBe("valu_installments");
    expect((PAYMENT_METHODS as readonly string[]).includes(VALU_INSTALLMENTS_METHOD_ID)).toBe(false);
  });
});

describe("isValuInstallmentsAvailable", () => {
  it("only when Fawaterak is offered", () => {
    expect(isValuInstallmentsAvailable([{ id: "cod" }, { id: "fawaterak" }])).toBe(true);
    expect(isValuInstallmentsAvailable([{ id: "cod" }])).toBe(false);
    expect(isValuInstallmentsAvailable([{ id: "cod" }, { id: "paymob" }, { id: "stripe" }])).toBe(false);
    expect(isValuInstallmentsAvailable([])).toBe(false);
    expect(isValuInstallmentsAvailable(undefined)).toBe(false);
  });
});

describe("copy", () => {
  it("never promises zero interest or zero fees", () => {
    const all = [
      ...(Object.values(VALU_INSTALLMENTS_COPY) as unknown[]).filter(
        (v): v is string => typeof v === "string",
      ),
      VALU_INSTALLMENTS_COPY.estimate("EGP 463.00"),
    ].join(" ");
    expect(all).not.toMatch(/0\s*%|zero|no (interest|fees?)|interest[- ]free|fee[- ]free/i);
    expect(VALU_INSTALLMENTS_COPY.estimate("EGP 463.00")).toBe(
      "Estimated EGP 463.00/month for 3 months",
    );
  });
});
