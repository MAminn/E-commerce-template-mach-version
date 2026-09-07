import { useMemo } from "react";
import type {
  HomepageCategoriesContent,
  CategoryLayoutVariant,
} from "#root/shared/types/homepage-content";
import type { CategoryStripItem } from "#root/components/shop/CategoryStrip";
import { StaggerContainer, StaggerItem } from "../../motion/Stagger";
import { normalizeMediaUrl } from "../MachMedia";
import { GROUND_PAPER, GUTTER, HEADING_SM } from "../machTokens";

/**
 * The header's measure.
 *
 * Not `SHELL`. The tiles below run full-bleed, so a header held to the
 * narrower content shell would sit visibly inset from the band it introduces.
 * This one lines up with the viewport gutter instead.
 */
const HEAD_SHELL = "mx-auto w-full max-w-[1920px]";

/**
 * Broad-group discovery — the block directly under the hero.
 *
 * This is the one piece of navigation the Mach storefront puts on the
 * homepage, and it is deliberately *not* merchandising. The reference stores
 * open the same way: a band of large, full-bleed campaign tiles that send a
 * shopper into a part of the store, with a title and one action over the
 * artwork and nothing else. No prices, no badges, no stock — the moment a tile
 * carries commercial detail it stops reading as a door and starts reading as a
 * product card, and the section below it is already the place for that.
 *
 * Mach sells out of three broad groups (Supplements, Stacks & Bundles, Gym
 * Gear), so this block is three panels wide, not a taxonomy grid. It composes
 * for whatever count the CMS gives it rather than assuming one:
 *
 *   desktop   one row, as many columns as there are groups, capped by the
 *             client's "tiles per row" setting so a tile is never a sliver
 *   mobile    a two-up grid; with an odd count the first tile spans the full
 *             width and leads, which is what turns three groups into the
 *             compact lead-plus-pair composition rather than three tall
 *             full-width cards
 *
 * **The artwork carries the section.** Tiles render at full colour — this is
 * campaign photography and it is the only source of energy in the block. (The
 * interface around it stays monochrome, and product pack shots keep their own
 * white-stage treatment elsewhere; nothing here is desaturated.)
 *
 * Everything the shopper reads is owned elsewhere. Which groups appear and in
 * what order is the CMS category selection; each tile's name, slug and artwork
 * belong to the category system; the section's heading, supporting line and
 * the action label on every tile come from homepage content. No category id,
 * name, image or destination is written in this file.
 */

const VARIANT_COLUMNS: Record<CategoryLayoutVariant, number> = {
  "tiles-4": 4,
  "tiles-3": 3,
  "tiles-2": 2,
};

/** Desktop row density, clamped so a short selection still fills the row. */
const LG_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

/**
 * Applies the client's selection and ordering.
 *
 * With nothing selected the section falls back to whatever the category system
 * already flags for the landing page, so the storefront is never empty just
 * because the CMS hasn't been touched yet.
 */
export function selectCategories(
  categories: CategoryStripItem[],
  categoryIds: string[] | undefined,
): CategoryStripItem[] {
  if (!categoryIds || categoryIds.length === 0) return categories.slice(0, 8);
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categoryIds
    .map((id) => byId.get(id))
    .filter((c): c is CategoryStripItem => Boolean(c));
}

export function MachCategoryTiles({
  content,
  categories,
  fallbackImages,
}: {
  content: HomepageCategoriesContent;
  categories: CategoryStripItem[];
  /**
   * Category id → a picture already loaded for this page, used only where the
   * category itself has no artwork uploaded yet.
   *
   * A discovery block whose whole job is imagery cannot ship as three black
   * rectangles while the client gets round to shooting group campaigns, and
   * inventing artwork here would be hard-coding storefront media. So the
   * caller hands over what the page already knows about each group and the
   * tile borrows it. Category artwork always wins the moment it exists.
   */
  fallbackImages?: Map<string, string>;
}) {
  const visible = useMemo(
    () => selectCategories(categories, content.categoryIds),
    [categories, content.categoryIds],
  );

  // A category block with nothing in it is not a section — it is a hole. The
  // catalog is being loaded, so hide rather than render a placeholder box.
  if (visible.length === 0) return null;

  const variant = content.layoutVariant ?? "tiles-4";
  const columns = Math.min(VARIANT_COLUMNS[variant], visible.length);
  // An odd selection leads with one wide tile on phones. An even one is a
  // plain two-up grid, which already balances.
  const leads = visible.length % 2 === 1 && visible.length > 1;

  const heading = content.title?.trim();
  const subtitle = content.subtitle?.trim();
  // One label, shown on every tile — each tile is its own destination, so a
  // separate section-level action would be the same word twice.
  const actionLabel = content.ctaText?.trim();

  return (
    <section id="categories" className={`${GROUND_PAPER} scroll-mt-24`}>
      {/* The header is optional on purpose. The reference composition puts the
          tiles straight under the hero with nothing above them, and this
          section is navigation rather than a merchandising shelf — so it gets
          a tight header when the client has written one and none at all when
          they clear the title. */}
      {(heading || subtitle) && (
        <div className={`${HEAD_SHELL} ${GUTTER} pb-6 pt-12 sm:pt-14 lg:pb-7`}>
          {heading && (
            <h2 className={`${HEADING_SM} text-[var(--mach-ink)]`}>
              {heading}
            </h2>
          )}
          {subtitle && (
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[var(--mach-mute)] sm:text-[15px]">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Full-bleed: the tiles run to the viewport edge, not a content shell.
          A hairline of ink between them is the only separation — the band has
          to read as one object, the way the reference stores' category bands
          do, rather than as three floating cards on a page. */}
      <StaggerContainer
        className={`grid w-full grid-cols-2 gap-px bg-[var(--mach-ink)] ${
          LG_COLUMNS[columns] ?? "lg:grid-cols-3"
        }`}>
        {visible.map((category, index) => {
          const img =
            normalizeMediaUrl(category.imageUrl) ||
            fallbackImages?.get(category.id) ||
            null;
          const isLead = leads && index === 0;

          return (
            <StaggerItem
              key={category.id}
              className={isLead ? "col-span-2 lg:col-span-1" : ""}>
              <a
                href={`/categories/${category.slug}`}
                className={`group relative flex w-full items-end justify-center overflow-hidden bg-[var(--mach-ink)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white lg:aspect-auto lg:h-[clamp(360px,30vw,560px)] ${
                  isLead ? "aspect-16/9" : "aspect-square"
                }`}>
                {img ? (
                  <>
                    {/* Full colour, always. The photography is the section. */}
                    <img
                      src={img}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    {/* Veil under the type. Weighted for the worst case
                        rather than the best one: a category can be given a
                        bright, light-background shot, and white type has to
                        survive it. The top of the frame stays close to clear
                        so the picture still reads as the picture. */}
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-linear-to-t from-black/90 via-black/45 to-black/10 transition-opacity duration-500 group-hover:from-black/75"
                    />
                  </>
                ) : (
                  // No artwork anywhere yet — the tile becomes a type
                  // composition rather than a grey rectangle.
                  <div aria-hidden="true" className="absolute inset-0">
                    <div className="absolute inset-0 bg-[var(--mach-ink-soft)]" />
                    <div className="absolute -right-[20%] top-[-30%] h-[160%] w-[46%] rotate-12 bg-[var(--mach-ink)]" />
                  </div>
                )}

                {/* Title and action, centred low over the artwork. Two lines of
                    type and nothing else — this is a door, not a card. */}
                <div className="relative z-10 flex w-full flex-col items-center px-4 pb-6 text-center sm:px-6 sm:pb-8 lg:pb-10">
                  <h3 className="font-black uppercase leading-[0.95] tracking-[-0.02em] text-white text-[clamp(1.05rem,2.2vw,2.25rem)]">
                    {category.name}
                  </h3>
                  {actionLabel && (
                    <span className="mt-2.5 inline-block border-b-2 border-white/70 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition-colors duration-300 group-hover:border-white sm:mt-3 sm:text-[11px]">
                      {actionLabel}
                    </span>
                  )}
                </div>
              </a>
            </StaggerItem>
          );
        })}
      </StaggerContainer>
    </section>
  );
}
