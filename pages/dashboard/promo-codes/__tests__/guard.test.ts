import { describe, expect, it } from "vitest";
import { guard as dashboardGuard } from "../../+guard";
import { data } from "../+data";

/**
 * The Promo Codes page keeps its existing access rules: admins (and
 * superadmins) only. A media buyer is still sent back to Landing 2, exactly
 * as before Free Shipping existed.
 */

function ctx(role: string | null, urlPathname: string) {
  return { clientSession: role ? { role } : undefined, urlPathname } as never;
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

describe("dashboard guard — promo codes", () => {
  it.each(["admin", "superadmin"])("keeps %s on promo codes", async (role) => {
    expect(await redirectOf(() => dashboardGuard(ctx(role, "/dashboard/promo-codes")))).toBeNull();
  });

  it("sends a media buyer from promo codes back to Landing 2", async () => {
    expect(await redirectOf(() => dashboardGuard(ctx("media_buyer", "/dashboard/promo-codes")))).toBe(
      "/dashboard/landing-2",
    );
  });

  it("refuses customers and guests", async () => {
    expect(await redirectOf(() => dashboardGuard(ctx("user", "/dashboard/promo-codes")))).toBe("/");
    expect(await redirectOf(() => dashboardGuard(ctx(null, "/dashboard/promo-codes")))).toBe("/login");
  });
});

describe("promo codes page data", () => {
  it.each(["user", "vendor", "media_buyer"])("refuses %s before loading anything", async (role) => {
    const result = await data({ clientSession: { role }, db: null } as never);
    expect(result).toMatchObject({ success: false, error: "Unauthorized" });
  });

  it("refuses a guest", async () => {
    const result = await data({ clientSession: undefined, db: null } as never);
    expect(result).toMatchObject({ success: false, error: "Unauthorized" });
  });
});
