import { redirect } from "vike/abort";
import { canEditLandingPage } from "#root/shared/landing-page/config";

/**
 * Landing 2 settings: admins, superadmins and media buyers. This is the only
 * dashboard page a media buyer can open.
 */
export async function guard(pageContext: Vike.PageContext) {
  if (!pageContext.clientSession) {
    throw redirect("/login");
  }

  if (!canEditLandingPage(pageContext.clientSession.role)) {
    throw redirect("/");
  }
}
