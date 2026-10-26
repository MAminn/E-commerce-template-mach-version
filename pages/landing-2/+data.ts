import type { PageContext } from "vike/types";
import { getLandingPageView } from "#root/backend/landing-page/service";
import { runBackendEffect } from "#root/shared/backend/effect";
import {
  DEFAULT_LANDING_PAGE_SETTINGS,
  type LandingPageSettings,
} from "#root/shared/landing-page/config";
import { provideDatabase } from "#root/shared/trpc/server";

type ViewProduct = Awaited<
  ReturnType<typeof loadView>
>["products"][number];

export type Data = {
  settings: LandingPageSettings;
  /** Catalogue rows in the chosen order, minus the description nobody renders. */
  products: Omit<ViewProduct, "description">[];
};

const loadView = async (ctx: PageContext) => {
  const result = await runBackendEffect(
    getLandingPageView().pipe(provideDatabase({ db: ctx.db })),
  );
  if (!result.success) throw result.error;
  return result.result;
};

/**
 * SSR loader for /landing-2.
 *
 * The hero and the products are in the first paint — ad traffic lands here
 * cold, so nothing waits on a client fetch. Products come from the live
 * catalogue on every request, which is what keeps price, discount, stock and
 * photos in step with Dashboard → Products.
 */
export const data = async (ctx: PageContext): Promise<Data> => {
  try {
    const view = await loadView(ctx);
    return {
      settings: view.settings,
      products: view.products.map(({ description: _d, ...product }) => product),
    };
  } catch (error) {
    console.error("Landing 2 failed to load:", error);
    // Never fail the page an ad points at; show the default hero instead.
    return {
      settings: structuredClone(DEFAULT_LANDING_PAGE_SETTINGS),
      products: [],
    };
  }
};
