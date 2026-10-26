import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "#root/backend/auth/shared/entities";
import { DEFAULT_LANDING_PAGE_SETTINGS } from "#root/shared/landing-page/config";
import { usersRouter } from "#root/backend/users/trpc";
import { whatsappRouter } from "#root/backend/whatsapp/trpc";
import { upsellRouter } from "#root/backend/upsells/trpc";
import { homepageRouter } from "#root/backend/homepage/trpc";
import { landingPageRouter } from "../trpc";

// The landing procedures admit admin, superadmin and media_buyer; everyone
// else is refused before the database is touched. The db in the context
// throws on any use, so a missing guard fails loudly. The second half pins
// the other direction: a media buyer gets nothing from the admin routers.

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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const calls = {
  getSettings: (s: ClientSession | null) =>
    landingPageRouter.createCaller(ctx(s)).getSettings(),
  updateSettings: (s: ClientSession | null) =>
    landingPageRouter
      .createCaller(ctx(s))
      .updateSettings(structuredClone(DEFAULT_LANDING_PAGE_SETTINGS)),
  uploadImage: (s: ClientSession | null) =>
    landingPageRouter
      .createCaller(ctx(s))
      .uploadImage({ file: { name: "a.png", type: "image/png", buffer: PNG } }),
};

type Proc = keyof typeof calls;
const procs = Object.keys(calls) as Proc[];

describe("landing page procedures — authorization", () => {
  it.each(procs)("%s rejects a guest with UNAUTHORIZED", async (proc) => {
    await expect(calls[proc](null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(procs.flatMap((p) => (["user", "vendor"] as const).map((r) => [r, p] as const)))(
    "%s role → %s is FORBIDDEN",
    async (role, proc) => {
      await expect(calls[proc](session(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it.each(["admin", "superadmin", "media_buyer"] as const)(
    "%s passes the guard and reaches the database",
    async (role) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const res = await calls.getSettings(session(role));
        // The wrapped service failure, not an auth error.
        expect(res.success).toBe(false);
        expect(String(log.mock.calls[0]?.[0])).toMatch(/database must not be touched/);
      } finally {
        log.mockRestore();
      }
    },
  );

  it("media buyers may upload images but nothing else through this route", async () => {
    const res = await landingPageRouter
      .createCaller(ctx(session("media_buyer")))
      .uploadImage({ file: { name: "c.pdf", type: "application/pdf", buffer: PNG } });
    expect(res).toMatchObject({ success: false, error: expect.stringMatching(/Unsupported image type/) });
  });

  it("rejects a malformed save before the database", async () => {
    await expect(
      landingPageRouter.createCaller(ctx(session("media_buyer"))).updateSettings({
        ...structuredClone(DEFAULT_LANDING_PAGE_SETTINGS),
        productIds: ["not-a-uuid"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("a media buyer gets nothing from admin routes", () => {
  const buyer = session("media_buyer");

  it("cannot list or create users (so cannot promote itself)", async () => {
    const users = usersRouter.createCaller(ctx(buyer));
    await expect(users.list({ limit: 10, offset: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      users.update({ id: "u1", role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cannot change store settings", async () => {
    await expect(
      whatsappRouter.createCaller(ctx(buyer)).updateSettings({
        enabled: true,
        phoneNumber: "201012345678",
        message: "",
        visibility: "both",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(upsellRouter.createCaller(ctx(buyer)).getSettings()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("cannot use the homepage CMS upload", async () => {
    const res = await homepageRouter
      .createCaller(ctx(buyer))
      .uploadMedia({ file: { name: "a.png", type: "image/png", buffer: PNG } });
    expect(res).toEqual({
      success: false,
      error: "Unauthorized. Only admins can upload homepage media.",
    });
  });
});
