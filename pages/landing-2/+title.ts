import type { PageContext } from "vike/types";
import { STORE_NAME } from "#root/shared/config/branding";
import type { Data } from "./+data";

export default function title(pageContext: PageContext) {
  const brand = pageContext.brandName || STORE_NAME;
  const headline = (pageContext.data as Data | undefined)?.settings.hero.title;
  return headline ? `${headline} | ${brand}` : brand;
}
