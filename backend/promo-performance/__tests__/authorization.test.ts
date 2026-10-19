import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "#root/backend/auth/shared/entities";
import { promoPerformanceRouter } from "../trpc";

// Both procedures are adminProcedure: a guest gets UNAUTHORIZED and a
// logged-in non-admin gets FORBIDDEN before the database is touched. The db
// in the context throws on any use, so a missing guard fails loudly.

const explodingDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`database must not be touched (accessed ${String(prop)})`);
    },
  },
);

function makeCaller(clientSession: ClientSession | null) {
  return promoPerformanceRouter.createCaller({
    db: explodingDb as never,
    clientSession: clientSession as never,
    emailService: null as never,
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  });
}

function session(role: ClientSession["role"]): ClientSession {
  return {
    id: "u1",
    token: "t",
    email: "x@example.com",
    name: "X",
    phone: "",
    expiresAt: new Date(Date.now() + 60_000),
    role,
  };
}

const calls = {
  summary: (c: ReturnType<typeof makeCaller>) => c.summary({ range: { from: "2026-10-01", to: "2026-10-31" } }),
  orders: (c: ReturnType<typeof makeCaller>) =>
    c.orders({ range: { from: "2026-10-01", to: "2026-10-31" }, code: "AHMED10", limit: 25, offset: 0 }),
};

describe("promo performance procedures — authorization", () => {
  it.each(Object.keys(calls) as (keyof typeof calls)[])("%s rejects a guest with UNAUTHORIZED", async (proc) => {
    await expect(calls[proc](makeCaller(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each([
    ["user", "summary"],
    ["user", "orders"],
    ["vendor", "summary"],
    ["vendor", "orders"],
  ] as const)("%s role → %s is FORBIDDEN", async (role, proc) => {
    await expect(calls[proc](makeCaller(session(role)))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["admin", "superadmin"] as const)("%s passes the guard and reaches the database", async (role) => {
    // The exploding db proves the guard let the call through: the result is
    // the wrapped service failure, not an auth error.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await calls.summary(makeCaller(session(role)));
      expect(res).toEqual({
        success: false,
        error: "Couldn't load the promo performance report — please try again.",
      });
      expect(String(log.mock.calls[0]?.[0])).toMatch(/database must not be touched/);
    } finally {
      log.mockRestore();
    }
  });

  it("rejects malformed ranges before the database", async () => {
    await expect(
      makeCaller(session("admin")).summary({ range: { from: "2026-10-31", to: "2026-10-01" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects open-ended and overlong ranges before the database", async () => {
    await expect(makeCaller(session("admin")).summary({ range: {} as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      makeCaller(session("admin")).summary({ range: { from: "2026-09-01", to: "2026-10-31" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
