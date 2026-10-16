import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ORDERS_EXPORT_ENDPOINT } from "#root/shared/orders/order-export";
import { ordersExportApiPlugin } from "../api";

/**
 * The export route's gate, driven through Fastify. The database stand-in
 * throws on any use, so a request that is refused provably never reached it.
 */

let instance: FastifyInstance;
const dbTouched = vi.fn();

async function appFor(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("clientSession", undefined);
  // Stand-in for the auth middleware: the role comes from a test header.
  app.addHook("onRequest", async (req) => {
    const role = req.headers["x-test-role"];
    req.clientSession =
      typeof role === "string"
        ? ({ id: "u1", role } as unknown as NonNullable<typeof req.clientSession>)
        : undefined;
  });
  await app.register(ordersExportApiPlugin, {
    getDb: () => {
      dbTouched();
      throw new Error("database must not be reached");
    },
  });
  return app;
}

beforeEach(async () => {
  dbTouched.mockClear();
  instance = await appFor();
});

afterEach(async () => {
  await instance.close();
});

describe("orders CSV export authorization", () => {
  it("rejects a signed-out request with 401", async () => {
    const res = await instance.inject({ method: "GET", url: ORDERS_EXPORT_ENDPOINT });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it.each(["user", "vendor"])("rejects role %s with 403", async (role) => {
    const res = await instance.inject({
      method: "GET",
      url: ORDERS_EXPORT_ENDPOINT,
      headers: { "x-test-role": role },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toMatch(/Order Number/);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it("rejects invalid filters with 400 before touching the database", async () => {
    for (const query of ["status=deleted", "dateFrom=not-a-date", "paymentIssueOnly=yes"]) {
      const res = await instance.inject({
        method: "GET",
        url: `${ORDERS_EXPORT_ENDPOINT}?${query}`,
        headers: { "x-test-role": "admin" },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it.each(["admin", "superadmin"])("lets %s through to the database", async (role) => {
    const res = await instance.inject({
      method: "GET",
      url: ORDERS_EXPORT_ENDPOINT,
      headers: { "x-test-role": role },
    });
    expect(dbTouched).toHaveBeenCalledTimes(1);
    // The stand-in DB throws: a clean 500, not a crash or a partial file.
    expect(res.statusCode).toBe(500);
    expect(res.headers["content-disposition"]).toBeUndefined();
  });

  it("only answers GET", async () => {
    const res = await instance.inject({
      method: "POST",
      url: ORDERS_EXPORT_ENDPOINT,
      headers: { "x-test-role": "admin" },
    });
    expect(res.statusCode).toBe(404);
  });
});
