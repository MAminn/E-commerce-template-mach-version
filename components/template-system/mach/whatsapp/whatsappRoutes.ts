/**
 * Where the floating WhatsApp button may appear.
 *
 * The layout already keeps it off `/dashboard` and the chrome-less `/links`
 * page; those are repeated here so the component is safe wherever it is
 * mounted. The rest:
 *
 *  - `/template-preview` — the CMS template preview, not the live storefront.
 *  - `/checkout` — the transaction surface stays free of floating UI, so
 *    nothing can sit over the order form or the Place Order control.
 *
 * Cart, account, order confirmation and the informational pages keep it: a
 * shopper with a question is exactly who the button is for.
 */
export const WHATSAPP_EXCLUDED_PREFIXES = [
  "/dashboard",
  "/links",
  "/template-preview",
  "/checkout",
] as const;

/** Whole-segment prefix match, as in lib/social-proof-routes.ts. */
export function isWhatsAppExcludedRoute(pathname: string): boolean {
  return WHATSAPP_EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
