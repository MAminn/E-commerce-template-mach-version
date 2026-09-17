import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "#root/backend/auth/shared/entities";
import { homepageRouter } from "#root/backend/homepage/trpc";

// The testimonial import procedures are adminProcedure: guests get
// UNAUTHORIZED and logged-in non-admins FORBIDDEN before the service — and
// the database — is touched. The db proxy throws on any access so a missing
// guard fails loudly instead of quietly succeeding.

const explodingDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`database must not be touched (accessed ${String(prop)})`);
    },
  },
);

function makeCaller(clientSession: ClientSession | null) {
  return homepageRouter.createCaller({
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

const CSV = "name,rating,review\nAnn,5,Loved it a lot\n";

describe("testimonial import procedures — authorization", () => {
  it.each(["previewTestimonialImport", "importTestimonials"] as const)(
    "%s rejects a guest with UNAUTHORIZED",
    async (proc) => {
      await expect(makeCaller(null)[proc]({ csvText: CSV })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    },
  );

  it.each([
    ["user", "previewTestimonialImport"],
    ["user", "importTestimonials"],
    ["vendor", "previewTestimonialImport"],
    ["vendor", "importTestimonials"],
  ] as const)("%s role → %s is FORBIDDEN", async (role, proc) => {
    await expect(makeCaller(session(role))[proc]({ csvText: CSV })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it.each(["admin", "superadmin"] as const)("%s passes the guard and reaches the service", async (role) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await makeCaller(session(role)).previewTestimonialImport({ csvText: CSV });
      // The exploding db proves the guard let the call through: the failure
      // is the service's DatabaseQueryError, not an auth error.
      expect(res.success).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        "[Database Query Error]",
        expect.objectContaining({ message: expect.stringMatching(/database must not be touched/) }),
      );
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  describe("homepage.updateContent (the general CMS save)", () => {
    const input = {
      merchantId: "00000000-0000-0000-0000-000000000001",
      templateId: "landing-editorial",
      content: { hero: { enabled: true, title: "x", subtitle: "", ctaText: "", ctaLink: "/" } } as never,
    };

    it("rejects a guest with UNAUTHORIZED", async () => {
      await expect(makeCaller(null).updateContent(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it.each(["user", "vendor"] as const)("%s role is FORBIDDEN", async (role) => {
      await expect(makeCaller(session(role)).updateContent(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it.each(["admin", "superadmin"] as const)("%s passes the guard", async (role) => {
      // Past the guard the handler hits the real db() singleton, which is not
      // configured here — any error other than an auth TRPCError proves the
      // guard let the call through.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await makeCaller(session(role)).updateContent(input).then(
          () => undefined,
          (err: { code?: string }) => {
            expect(err.code).not.toBe("UNAUTHORIZED");
            expect(err.code).not.toBe("FORBIDDEN");
          },
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  it("rejects a payload over the size cap before any work is done", async () => {
    await expect(
      makeCaller(session("admin")).importTestimonials({ csvText: "x".repeat(2 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
