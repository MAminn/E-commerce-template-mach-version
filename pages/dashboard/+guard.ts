import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { isSingleShopMode } from "#root/shared/config/app";
import { LANDING_PAGE_DASHBOARD_PATH } from "#root/shared/landing-page/config";

export async function guard(pageContext: PageContextServer) {
  if (!pageContext.clientSession) {
    throw redirect("/login");
  }

  // A media buyer manages the Landing 2 page and nothing else; every other
  // dashboard route sends them back to it.
  if (pageContext.clientSession.role === "media_buyer") {
    const path = pageContext.urlPathname.replace(/\/+$/, "");
    if (path !== LANDING_PAGE_DASHBOARD_PATH) {
      throw redirect(LANDING_PAGE_DASHBOARD_PATH);
    }
    return;
  }

  // In single-shop mode, only admins (and superadmins) can access dashboard
  if (
    isSingleShopMode() &&
    pageContext.clientSession.role !== "admin" &&
    pageContext.clientSession.role !== "superadmin"
  ) {
    throw redirect("/");
  }

  // In multi-vendor mode, redirect users with 'user' role to the homepage
  if (!isSingleShopMode() && pageContext.clientSession.role === "user") {
    throw redirect("/");
  }
}
