import { describe, expect, it } from "vitest";
import {
  BOSTA_STATE_NAMES,
  getBostaStateName,
  mapBostaStateToOrderStatus,
  resolveNextOrderStatus,
  type LocalOrderStatus,
} from "../states";

describe("Bosta state table", () => {
  it("covers every documented state code with its documented name", () => {
    expect(BOSTA_STATE_NAMES).toEqual({
      10: "Pickup requested",
      11: "Waiting for route",
      20: "Route Assigned",
      21: "Picked up from business",
      22: "Picking up from consignee",
      23: "Picked up from consignee",
      24: "Received at warehouse",
      25: "Fulfilled",
      30: "In transit between Hubs",
      40: "Picking up",
      41: "Picked up",
      45: "Delivered",
      46: "Returned to business",
      47: "Exception",
      48: "Terminated",
      49: "Canceled",
      60: "Returned to stock",
      100: "Lost",
      101: "Damaged",
      102: "Investigation",
      103: "Awaiting your action",
      104: "Archived",
      105: "On hold",
    });
  });

  it("labels unknown codes instead of throwing", () => {
    expect(getBostaStateName(999)).toBe("Unknown state (999)");
  });
});

describe("mapBostaStateToOrderStatus", () => {
  const expected: Record<number, { type: "set"; status: LocalOrderStatus } | { type: "keep" }> = {
    10: { type: "set", status: "processing" },
    11: { type: "set", status: "processing" },
    20: { type: "set", status: "processing" },
    21: { type: "set", status: "shipped" },
    22: { type: "keep" },
    23: { type: "keep" },
    24: { type: "set", status: "shipped" },
    25: { type: "keep" },
    30: { type: "set", status: "shipped" },
    40: { type: "keep" },
    41: { type: "set", status: "shipped" },
    45: { type: "set", status: "delivered" },
    46: { type: "set", status: "cancelled" },
    47: { type: "keep" },
    48: { type: "set", status: "cancelled" },
    49: { type: "set", status: "cancelled" },
    60: { type: "keep" },
    100: { type: "set", status: "cancelled" },
    101: { type: "set", status: "cancelled" },
    102: { type: "keep" },
    103: { type: "keep" },
    104: { type: "keep" },
    105: { type: "keep" },
  };

  for (const [code, action] of Object.entries(expected)) {
    it(`code ${code} → ${action.type === "set" ? action.status : "keep"}`, () => {
      expect(mapBostaStateToOrderStatus(Number(code))).toEqual(action);
    });
  }

  it("unknown codes keep the current status", () => {
    expect(mapBostaStateToOrderStatus(9999)).toEqual({ type: "keep" });
  });
});

describe("resolveNextOrderStatus (no-downgrade rules)", () => {
  it("keep never changes anything", () => {
    for (const s of ["pending", "processing", "shipped", "delivered", "cancelled"] as const) {
      expect(resolveNextOrderStatus(s, { type: "keep" })).toBeNull();
    }
  });

  it("delivered does not regress to shipped/processing", () => {
    expect(resolveNextOrderStatus("delivered", mapBostaStateToOrderStatus(24))).toBeNull();
    expect(resolveNextOrderStatus("delivered", mapBostaStateToOrderStatus(10))).toBeNull();
  });

  it("cancelled does not regress to shipped/processing", () => {
    expect(resolveNextOrderStatus("cancelled", mapBostaStateToOrderStatus(41))).toBeNull();
    expect(resolveNextOrderStatus("cancelled", mapBostaStateToOrderStatus(20))).toBeNull();
  });

  it("shipped does not regress to processing on a late 'Route Assigned'", () => {
    expect(resolveNextOrderStatus("shipped", mapBostaStateToOrderStatus(20))).toBeNull();
  });

  it("progresses forward and to terminal states", () => {
    expect(resolveNextOrderStatus("processing", mapBostaStateToOrderStatus(41))).toBe("shipped");
    expect(resolveNextOrderStatus("shipped", mapBostaStateToOrderStatus(45))).toBe("delivered");
    expect(resolveNextOrderStatus("shipped", mapBostaStateToOrderStatus(48))).toBe("cancelled");
    expect(resolveNextOrderStatus("pending", mapBostaStateToOrderStatus(100))).toBe("cancelled");
  });

  it("a genuine terminal Bosta state may replace another terminal status", () => {
    expect(resolveNextOrderStatus("delivered", mapBostaStateToOrderStatus(46))).toBe("cancelled");
    expect(resolveNextOrderStatus("cancelled", mapBostaStateToOrderStatus(45))).toBe("delivered");
  });

  it("returns null when the status is already the target", () => {
    expect(resolveNextOrderStatus("shipped", mapBostaStateToOrderStatus(41))).toBeNull();
  });
});
