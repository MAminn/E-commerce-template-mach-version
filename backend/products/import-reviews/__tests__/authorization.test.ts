import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "#root/backend/auth/shared/entities";
import { createReviewSchema } from "#root/backend/products/create-review/service";
import { productRouter } from "#root/backend/products/trpc";

// The import procedures are adminProcedure: a guest gets UNAUTHORIZED and a
// logged-in non-admin gets FORBIDDEN before the service — and therefore the
// database — is ever touched. The db in the context throws on any use so a
// missing guard would fail loudly here rather than silently succeed.

const explodingDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`database must not be touched (accessed ${String(prop)})`);
    },
  },
);

function makeCaller(clientSession: ClientSession | null) {
  return productRouter.createCaller({
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

const CSV = "productSlug,userName,rating,comment\nsynt-aura,Ann,5,Loved it a lot\n";

describe("review import procedures — authorization", () => {
  it.each(["previewReviewImport", "importReviews"] as const)(
    "%s rejects a guest with UNAUTHORIZED",
    async (proc) => {
      const caller = makeCaller(null);
      await expect(caller[proc]({ csvText: CSV })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    },
  );

  it.each([
    ["user", "previewReviewImport"],
    ["user", "importReviews"],
    ["vendor", "previewReviewImport"],
    ["vendor", "importReviews"],
  ] as const)("%s role → %s is FORBIDDEN", async (role, proc) => {
    const caller = makeCaller(session(role));
    await expect(caller[proc]({ csvText: CSV })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it.each(["admin", "superadmin"] as const)(
    "%s passes the guard and reaches the service",
    async (role) => {
      const caller = makeCaller(session(role));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        // The exploding db proves the guard let the call through: the failure
        // is the service's DatabaseQueryError, not an auth error.
        const res = await caller.previewReviewImport({ csvText: CSV });
        expect(res.success).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          "[Database Query Error]",
          expect.objectContaining({ message: expect.stringMatching(/database must not be touched/) }),
        );
      } finally {
        consoleSpy.mockRestore();
      }
    },
  );

  it("rejects a payload over the size cap before any work is done", async () => {
    const caller = makeCaller(session("admin"));
    await expect(
      caller.importReviews({ csvText: "x".repeat(4 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the public createReview procedure still cannot set a status", () => {
    // Guard against the importer's "publish immediately" leaking into the
    // storefront endpoint: its input schema has no status/approved key.
    const keys = Object.keys(createReviewSchema.shape);
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("publishImmediately");
    expect(keys).not.toContain("importKey");
  });
});
