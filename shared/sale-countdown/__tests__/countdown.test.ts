import { describe, expect, it } from "vitest";
import {
  clockOffsetMs,
  effectiveCountdownStatus,
  formatCountdown,
  msUntilNextTick,
  postSaleDiscountPrice,
  saleItemProblems,
  toCents,
} from "../countdown";

describe("formatCountdown", () => {
  it("shows HH:MM:SS, rounding up so the last second reads 00:00:01", () => {
    expect(formatCountdown(60 * 60_000 - 1000)).toBe("00:59:59");
    expect(formatCountdown(60 * 60_000)).toBe("01:00:00");
    expect(formatCountdown(59_001)).toBe("00:01:00");
    expect(formatCountdown(1)).toBe("00:00:01");
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(-5000)).toBe("00:00:00");
  });

  it("adds days for long countdowns", () => {
    expect(formatCountdown((2 * 86_400 + 3 * 3600 + 4 * 60 + 5) * 1000)).toBe("2d 03:04:05");
  });
});

describe("effectiveCountdownStatus", () => {
  const now = new Date("2026-11-27T20:00:00Z");
  it("is expired the moment a running deadline passes, before any job runs", () => {
    expect(effectiveCountdownStatus({ status: "running", endsAt: new Date(now.getTime() + 1) }, now)).toBe("running");
    expect(effectiveCountdownStatus({ status: "running", endsAt: now }, now)).toBe("expired");
    expect(effectiveCountdownStatus({ status: "running", endsAt: null }, now)).toBe("expired");
  });
  it("keeps stored inactive/expired, and no row is inactive", () => {
    expect(effectiveCountdownStatus({ status: "inactive", endsAt: new Date(now.getTime() + 9e6) }, now)).toBe("inactive");
    expect(effectiveCountdownStatus({ status: "expired", endsAt: null }, now)).toBe("expired");
    expect(effectiveCountdownStatus(null, now)).toBe("inactive");
  });
});

describe("postSaleDiscountPrice", () => {
  it("keeps a discount below the list price, removes it at list price", () => {
    expect(postSaleDiscountPrice("2700.00", "2500")).toEqual({ discountPrice: "2500.00", cappedAtListPrice: false });
    expect(postSaleDiscountPrice("600.00", 600)).toEqual({ discountPrice: null, cappedAtListPrice: false });
  });
  it("never charges above the list price", () => {
    expect(postSaleDiscountPrice("2000.00", "2600.00")).toEqual({ discountPrice: null, cappedAtListPrice: true });
  });
  it("uses exact cents (no float drift)", () => {
    expect(postSaleDiscountPrice("0.30", "0.10")).toEqual({ discountPrice: "0.10", cappedAtListPrice: false });
    expect(toCents("1400.10")).toBe(140010);
  });
});

describe("saleItemProblems", () => {
  const item = (o: Partial<Parameters<typeof saleItemProblems>[0][number]> = {}) => ({
    productId: "p",
    name: "Whey",
    postSalePrice: "2500.00" as string | number | null,
    listPrice: "2700.00",
    deleted: false,
    ...o,
  });
  it("an empty sale is not ready", () => {
    expect(saleItemProblems([])).toHaveLength(1);
  });
  it("never accepts a missing price — no guessing", () => {
    expect(saleItemProblems([item({ postSalePrice: null })])).toEqual(["Whey: post-sale price is not set."]);
  });
  it("refuses deleted products and prices above list", () => {
    expect(saleItemProblems([item({ deleted: true })])[0]).toContain("deleted");
    expect(saleItemProblems([item({ postSalePrice: 2701 })])[0]).toContain("above the list price");
  });
  it("accepts explicit prices up to the list price", () => {
    expect(saleItemProblems([item(), item({ productId: "q", postSalePrice: 2700 })])).toEqual([]);
  });
});

describe("browser clock correction", () => {
  it("uses the round-trip midpoint", () => {
    // Browser clock 5 minutes slow; 200ms round trip.
    const serverNow = Date.parse("2026-11-27T20:00:00.100Z");
    const start = serverNow - 5 * 60_000 - 100;
    expect(clockOffsetMs(start, start + 200, new Date(serverNow).toISOString())).toBe(5 * 60_000);
    expect(clockOffsetMs(0, 0, "garbage")).toBe(0);
  });
  it("wakes exactly when the displayed second changes", () => {
    expect(msUntilNextTick(3_599_250)).toBe(250);
    expect(msUntilNextTick(3_599_000)).toBe(1000);
    expect(msUntilNextTick(0)).toBe(1000);
  });
});
