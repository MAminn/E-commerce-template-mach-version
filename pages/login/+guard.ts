import { redirect } from "vike/abort";
import { isSingleShopMode } from "#root/shared/config/app";
import { dashboardHomeForRole } from "#root/shared/landing-page/config";

export async function guard(pageContext: Vike.PageContext) {
  if (pageContext.clientSession) {
    // In single-shop mode, admins (and superadmins) go to the dashboard and
    // media buyers to the one page they manage
    if (isSingleShopMode()) {
      const home = dashboardHomeForRole(pageContext.clientSession.role);
      if (home) {
        throw redirect(home);
      }
      // All other roles (user, vendor) go to homepage
      throw redirect("/");
    }

    // Multi-vendor mode: redirect users to homepage, admin/vendor to dashboard
    if (pageContext.clientSession.role === "user") {
      throw redirect("/");
    }
    throw redirect(
      dashboardHomeForRole(pageContext.clientSession.role) ?? "/dashboard",
    );
  }
}
