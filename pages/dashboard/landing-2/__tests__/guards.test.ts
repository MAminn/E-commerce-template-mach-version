import { describe, expect, it } from "vitest";
import { guard as dashboardGuard } from "../../+guard";
import { guard as landingGuard } from "../+guard";
import { guard as loginGuard } from "../../../login/+guard";

/**
 * A media buyer's dashboard is exactly one page. Every other dashboard route
 * sends them to it, and the page itself admits only its editor roles.
 */

function ctx(role: string | null, urlPathname: string) {
  return {
    clientSession: role ? { role } : undefined,
    urlPathname,
  } as never;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const url = (error as { _pageContextAbort?: { _urlRedirect?: { url: string } } })
      ._pageContextAbort?._urlRedirect?.url;
    if (!url) throw error;
    return url;
  }
}

describe("dashboard guard", () => {
  it.each(["/dashboard", "/dashboard/orders", "/dashboard/users", "/dashboard/admin/homepage"])(
    "sends a media buyer from %s to Landing 2",
    async (path) => {
      expect(await redirectOf(() => dashboardGuard(ctx("media_buyer", path)))).toBe(
        "/dashboard/landing-2",
      );
    },
  );

  it("lets a media buyer stay on Landing 2", async () => {
    expect(await redirectOf(() => dashboardGuard(ctx("media_buyer", "/dashboard/landing-2")))).toBeNull();
  });

  it("keeps admins where they are", async () => {
    expect(await redirectOf(() => dashboardGuard(ctx("admin", "/dashboard/orders")))).toBeNull();
  });
});

describe("Landing 2 settings guard", () => {
  it.each(["admin", "superadmin", "media_buyer"])("admits %s", async (role) => {
    expect(await redirectOf(() => landingGuard(ctx(role, "/dashboard/landing-2")))).toBeNull();
  });

  it("refuses a customer", async () => {
    expect(await redirectOf(() => landingGuard(ctx("user", "/dashboard/landing-2")))).toBe("/");
  });

  it("asks a guest to sign in", async () => {
    expect(await redirectOf(() => landingGuard(ctx(null, "/dashboard/landing-2")))).toBe("/login");
  });
});

describe("login guard", () => {
  it("sends a signed-in media buyer to Landing 2", async () => {
    expect(await redirectOf(() => loginGuard(ctx("media_buyer", "/login")))).toBe(
      "/dashboard/landing-2",
    );
  });
});
