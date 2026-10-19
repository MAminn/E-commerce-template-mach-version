import { describe, expect, it } from "vitest";
import { cairoMonth, monthRange, reportRangeSchema } from "../report";

describe("monthRange", () => {
  it("covers the whole calendar month", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("rejects malformed months", () => {
    expect(() => monthRange("2026-13")).toThrow();
    expect(() => monthRange("2026-1")).toThrow();
  });
});

describe("cairoMonth", () => {
  it("uses the Cairo calendar, not UTC", () => {
    // 22:30 UTC on 30 Sep = 01:30 on 1 Oct in Cairo (EEST, UTC+3).
    expect(cairoMonth(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10");
    // 21:59 UTC on 31 Oct = 23:59 on 31 Oct in Cairo (EET, UTC+2 after DST).
    expect(cairoMonth(new Date("2026-10-31T21:59:00Z"))).toBe("2026-10");
    expect(cairoMonth(new Date("2026-10-31T22:00:00Z"))).toBe("2026-11");
  });
});

describe("reportRangeSchema", () => {
  it("accepts open and closed ranges", () => {
    expect(reportRangeSchema.safeParse({}).success).toBe(true);
    expect(reportRangeSchema.safeParse({ from: "2026-10-01" }).success).toBe(true);
    expect(reportRangeSchema.safeParse({ from: "2026-10-01", to: "2026-10-01" }).success).toBe(true);
  });

  it("rejects bad dates and reversed ranges", () => {
    expect(reportRangeSchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ from: "10/01/2026" }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ from: "2026-10-02", to: "2026-10-01" }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ from: "2026-10-01'; drop table x;--" }).success).toBe(false);
  });
});
