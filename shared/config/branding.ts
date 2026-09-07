/**
 * Store branding configuration.
 * All values are configurable via environment variables.
 * VITE_-prefixed vars are available on both server and client.
 */

export const STORE_NAME =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_STORE_NAME) ||
  process.env.VITE_STORE_NAME ||
  "Mach Supplements";

export const STORE_CURRENCY =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_CURRENCY) ||
  process.env.VITE_CURRENCY ||
  "EGP";

export const STORE_DESCRIPTION =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_STORE_DESCRIPTION) ||
  process.env.VITE_STORE_DESCRIPTION ||
  "Sports nutrition and gym supplements built for serious training. Protein, creatine, pre-workout and daily essentials — delivered across Egypt.";

/**
 * Store business vertical.
 *
 * This is the store's *business identity* — what the shop actually SELLS.
 * It is deliberately a plain compile-time constant, NOT an env var and NOT
 * derived from any template selection:
 *
 *  - This repository is dedicated to Mach Supplements. The vertical cannot
 *    legitimately differ between environments, so there is nothing for an env
 *    var to vary, and an unset var would silently fall through to a bare
 *    `process.env` read that is not defined in the browser (vite.config.ts
 *    injects only SINGLE_SHOP_MODE). A constant is identical on server and
 *    client with no injection to get wrong.
 *  - Template selection (`templateSelection.landing`, `navbarStyle`, …) is
 *    client-changeable at any time from the admin. Keying business identity
 *    off it means another vertical's fields reappear the moment someone picks
 *    a different template — which is exactly the bug this replaced.
 *
 * To re-target a fork at another vertical, change this one line; every
 * consumer below follows. Legacy columns are never removed — the vertical
 * controls admin/storefront VISIBILITY only, so perfume-era data stays
 * readable and writable underneath.
 */
export type StoreVertical = "supplements" | "perfume" | "generic";

export const STORE_VERTICAL: StoreVertical = "supplements";

/** True when this store sells supplements (Mach). */
export function isSupplementStore(): boolean {
  return STORE_VERTICAL === "supplements";
}

/**
 * True when the inherited perfume-specific product fields (Inspired By,
 * Fragrance Info, Best Layered With) should be offered in the admin.
 */
export function showsPerfumeProductFields(): boolean {
  return STORE_VERTICAL !== "supplements";
}

/**
 * True when the description "Color" control should be offered.
 *
 * It writes a bespoke `[color:#hex]…[/color]` markup into the plain-text
 * description column, and ONLY ProductPageMinimal parses it back out. On any
 * other product template the raw markup is shown to customers verbatim, so it
 * is withheld from supplement stores. Existing description values are never
 * rewritten — this hides the authoring tool, not the data.
 */
export function showsDescriptionColorControls(): boolean {
  return !isSupplementStore();
}

/**
 * True when per-value variant price modifiers may be edited.
 *
 * `priceModifier` is display-only today: the server computes order totals from
 * product.price/discountPrice alone (backend/orders/create-order/service.ts),
 * so a differently-priced option is not actually charged. Until that is fixed,
 * supplement stores keep variants single-price — same-price flavours belong in
 * variants, differently-priced sizes belong in separate products.
 *
 * The column, the schemas and legacy behaviour for other deployments are
 * unchanged; stored modifiers round-trip untouched.
 */
export function showsVariantPriceModifiers(): boolean {
  return !isSupplementStore();
}
