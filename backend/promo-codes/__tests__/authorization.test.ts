import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "#root/backend/auth/shared/entities";
import { promoCodesRouter } from "../trpc";

/**
 * Promo code management keeps its existing authorization: admin and
 * superadmin only (adminProcedure), for every discount type — Free Shipping
 * included. Everyone else, media buyers too, is refused before the database
 * is touched (the db in the context throws on any use).
 */

const explodingDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`database must not be touched (accessed ${String(prop)})`);
    },
  },
);

function ctx(clientSession: ClientSession | null) {
  return {
    db: explodingDb as never,
    clientSession: clientSession as never,
    emailService: null as never,
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  };
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

const ID = "00000000-0000-4000-8000-000000000001";
const caller = (s: ClientSession | null) => promoCodesRouter.createCaller(ctx(s));

const calls = {
  list: (s: ClientSession | null) => caller(s).list({}),
  getById: (s: ClientSession | null) => caller(s).getById({ id: ID }),
  createFreeShipping: (s: ClientSession | null) =>
    caller(s).create({ code: "FREESHIP", discountType: "free_shipping" }),
  createPercentage: (s: ClientSession | null) =>
    caller(s).create({ code: "TENOFF", discountType: "percentage", discountValue: 10 }),
  updateToFreeShipping: (s: ClientSession | null) =>
    caller(s).update({ id: ID, discountType: "free_shipping" }),
  deactivate: (s: ClientSession | null) => caller(s).update({ id: ID, status: "inactive" }),
  delete: (s: ClientSession | null) => caller(s).delete({ id: ID }),
};
type Proc = keyof typeof calls;
const procs = Object.keys(calls) as Proc[];

/** Got past every role check and reached the (refused) database. */
async function expectReachesDatabase(call: () => Promise<unknown>) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await call();
    expect(result).toMatchObject({ success: false });
    const logged = [...log.mock.calls, ...error.mock.calls].flat().map(String).join("\n");
    expect(logged).toMatch(/database must not be touched/);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("promo code routes — existing authorization, unchanged", () => {
  it.each(procs)("%s rejects a guest with UNAUTHORIZED", async (proc) => {
    await expect(calls[proc](null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(
    procs.flatMap((proc) =>
      (["user", "vendor", "media_buyer"] as const).map((role) => [role, proc] as const),
    ),
  )("%s role → %s is FORBIDDEN", async (role, proc) => {
    await expect(calls[proc](session(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(
    procs.flatMap((proc) => (["admin", "superadmin"] as const).map((role) => [role, proc] as const)),
  )("%s passes the gate for %s", async (role, proc) => {
    await expectReachesDatabase(() => calls[proc](session(role)));
  });
});
