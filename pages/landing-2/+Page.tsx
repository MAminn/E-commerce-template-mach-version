import { useMemo } from "react";
import { useData } from "vike-react/useData";
import { MachLanding2Page } from "#root/components/template-system/mach/pages/MachLanding2Page";
import { mapSearchItem } from "../index/homepage-products";
import type { Data } from "./+data";

export { Page };

/**
 * /landing-2 — the one fixed marketing landing page.
 *
 * The URL is this file's location and never changes. Its content is managed
 * in Dashboard → Landing 2; see shared/landing-page/config.ts.
 */
function Page() {
  const { settings, products } = useData<Data>();
  // The homepage's own row mapper, so image paths and price coercion match
  // every other Mach shelf.
  const cards = useMemo(() => products.map(mapSearchItem), [products]);

  return (
    <MachLanding2Page
      hero={settings.hero}
      productsTitle={settings.productsTitle}
      products={cards}
    />
  );
}
