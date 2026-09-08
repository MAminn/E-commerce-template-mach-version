import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type {
  SupplementFactRow,
  SupplementInfo,
} from "#root/shared/types/supplement-info";

/**
 * Supplement label presentation.
 *
 * Deliberately lives outside the inherited Editorial template so supplement
 * rendering does not contaminate a generic product page.
 *
 * Every section is data-driven and self-hiding: nothing renders unless the
 * admin has actually entered it. No nutrition values are invented, and no
 * client-facing copy is hard-coded here beyond the fixed column headers of a
 * nutrition table and the field labels of the entered data.
 */

function hasText(v?: string): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const MUTE = "text-[var(--mach-mute)]";
const INK = "text-[var(--mach-ink)]";
const LABEL =
  "text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)]";

/**
 * Reading measures.
 *
 * Prose gets a comfortable line length; label data gets a narrow one. A
 * nutrition table stretched across a 1400px content column stops reading as a
 * label and starts reading as a spreadsheet, so it is capped well before the
 * column runs out.
 */
const MEASURE_PROSE = "max-w-[46rem]";
const MEASURE_LABEL = "max-w-[34rem]";

/* ------------------------------------------------------------------ */
/*  Supplement Facts table                                            */
/* ------------------------------------------------------------------ */

export function SupplementFactsPanel({
  rows,
  className = "",
}: {
  rows?: SupplementFactRow[];
  className?: string;
}) {
  const visible = (rows ?? []).filter((r) => hasText(r.label));
  if (visible.length === 0) return null;

  // A %DV column is only drawn when at least one row actually carries one.
  const showDailyValue = visible.some((r) => hasText(r.dailyValue));

  return (
    // Heavy rules top and bottom. That pair is what a nutrition panel is read
    // by — it closes the data off from the page without putting a card around
    // it, which is the treatment a printed label uses too.
    <div
      className={`overflow-x-auto border-b-2 border-t-2 border-[var(--mach-ink)] ${className}`}>
      <table className="w-full min-w-[17rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--mach-ink)]/25">
            <th
              className={`py-2.5 pe-3 text-start text-[10px] font-bold uppercase tracking-[0.16em] ${INK}`}>
              Amount Per Serving
            </th>
            <th className="px-3 py-2.5" />
            {showDailyValue && (
              <th
                className={`whitespace-nowrap py-2.5 ps-3 text-end text-[10px] font-bold uppercase tracking-[0.16em] ${INK}`}>
                % Daily Value
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, idx) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and may repeat labels
              key={idx}
              className="border-b border-[var(--mach-ink)]/12 last:border-0">
              <td
                className={`py-2.5 pe-3 ${INK} ${
                  row.indent ? "ps-5 font-normal" : "font-semibold"
                }`}>
                {row.label}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2.5 text-end font-semibold tabular-nums ${INK}`}>
                {hasText(row.amount) ? row.amount : ""}
              </td>
              {showDailyValue && (
                <td
                  className={`whitespace-nowrap py-2.5 ps-3 text-end tabular-nums ${MUTE}`}>
                  {hasText(row.dailyValue) ? row.dailyValue : ""}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Badges                                                            */
/* ------------------------------------------------------------------ */

export function SupplementBadges({ badges }: { badges?: string[] }) {
  const visible = (badges ?? []).filter(hasText);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((b) => (
        <span
          key={b}
          className="border border-[var(--mach-ink)]/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--mach-ink)]">
          {b}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Details block — desktop spec sheet, mobile accordion              */
/* ------------------------------------------------------------------ */

/**
 * One labelled block of product information.
 *
 * The same content presented two ways from a single DOM tree:
 *
 *  - From `lg` it is a spec-sheet row: the label sits in a fixed left rail and
 *    the content runs beside it, divided from the next block by a hairline and
 *    always open. Regulatory copy (ingredients, warnings) should not need a
 *    click on a screen with room for it, and a title rail is what keeps six
 *    blocks of wildly different length reading as one structured document
 *    rather than as a stack of separate panels.
 *  - Below `lg` it is a disclosure row: a full-width 48px trigger with a
 *    chevron. A phone cannot afford four prose blocks and a nutrition table
 *    between the purchase panel and the related products.
 *
 * The mobile trigger and the desktop label are two small elements, but the
 * *content* is rendered once — never duplicated in the DOM, so there is one
 * copy of the supplement facts for a crawler and for a screen reader. The
 * desktop state is produced by CSS rather than by measuring the viewport, so
 * there is no hydration mismatch and no post-mount reflow.
 */
function DetailBlock({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-[var(--mach-ink)]/12 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-8 lg:py-8 xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-x-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex min-h-12 w-full items-center justify-between gap-4 py-3.5 text-start lg:hidden ${LABEL}`}>
        {title}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-[var(--mach-ink)]/45 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <p className={`hidden lg:block lg:pt-px ${LABEL}`}>{title}</p>

      <div className={`${open ? "block" : "hidden"} pb-5 lg:block lg:pb-0`}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Full details panel                                                */
/* ------------------------------------------------------------------ */

/**
 * The whole product-information section below the hero.
 *
 * Renders nothing at all when the product carries no supplement data and no
 * SKU, so bundles and gym gear drop the section entirely rather than showing
 * empty accordions. Note that an admin who has opened and saved the supplement
 * form leaves `{}` behind rather than null — every gate below tests the
 * individual *fields*, so an empty object is as absent as a missing one.
 *
 * Grouping follows how a label is actually read rather than how the admin form
 * stores it:
 *
 *  - Serving size and servings per container belong to the nutrition panel and
 *    are printed directly above it, the way they are on the tub. They only
 *    fall back into Product Details when there is no facts table for them to
 *    caption.
 *  - Product Details is then what is left: the pack identifiers.
 *
 * That split is also what stops the same value being stated twice in one
 * section, which is what happened when both blocks drew from one flat list.
 */
export function SupplementDetailsPanel({
  info,
  sku,
  sectionHeading,
  shortDescription,
  className = "",
}: {
  info?: SupplementInfo | null;
  sku?: string | null;
  /** Section heading from product-page CMS content. */
  sectionHeading?: string;
  /**
   * The hero's short description. Used only to suppress a long description
   * that repeats it verbatim — never rendered here.
   */
  shortDescription?: string;
  className?: string;
}) {
  const facts = (info?.supplementFacts ?? []).filter((r) => hasText(r.label));
  const badges = (info?.badges ?? []).filter(hasText);
  const hasFacts = facts.length > 0;

  // Serving metadata captions the facts table when there is one; with no table
  // it has nowhere to sit, so it rejoins the pack identifiers below.
  const servingRows = [
    { label: "Serving Size", value: info?.servingSize ?? "" },
    { label: "Servings Per Container", value: info?.servingsPerContainer ?? "" },
  ].filter((r) => hasText(r.value));

  const packRows = [
    { label: "SKU", value: sku ?? "" },
    { label: "Net Weight", value: info?.netWeight ?? "" },
  ].filter((r) => hasText(r.value));

  const detailRows = hasFacts ? packRows : [...packRows, ...servingRows];

  // A long description that merely repeats the hero copy is not an editorial
  // block, it is the same sentence twice on one page.
  const rawLong = info?.longDescription;
  const longDescription =
    hasText(rawLong) && rawLong.trim() !== (shortDescription ?? "").trim()
      ? rawLong
      : undefined;

  const rawIngredients = info?.ingredients;
  const rawDirections = info?.directions;
  const rawWarnings = info?.warnings;
  const prose = {
    ingredients: hasText(rawIngredients) ? rawIngredients : undefined,
    directions: hasText(rawDirections) ? rawDirections : undefined,
    warnings: hasText(rawWarnings) ? rawWarnings : undefined,
  };

  const hasAnything =
    detailRows.length > 0 ||
    hasFacts ||
    badges.length > 0 ||
    Boolean(longDescription) ||
    Boolean(prose.ingredients) ||
    Boolean(prose.directions) ||
    Boolean(prose.warnings);

  if (!hasAnything) return null;

  // The first block on the page opens by default on mobile; the rest stay
  // closed so the section costs a phone a screen of headings, not a screen of
  // copy. `used` tracks whether that first slot has been claimed, since which
  // block comes first depends entirely on what this product carries.
  let used = false;
  const firstOpen = () => {
    if (used) return false;
    used = true;
    return true;
  };

  return (
    <section className={className}>
      {hasText(sectionHeading) && (
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black uppercase leading-[0.95] tracking-[-0.02em] text-[var(--mach-ink)]">
          {sectionHeading}
        </h2>
      )}

      {hasText(info?.detailsHeading) && (
        <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--mach-mute)]">
          {info?.detailsHeading}
        </p>
      )}

      {badges.length > 0 && (
        <div className="mt-6">
          <SupplementBadges badges={badges} />
        </div>
      )}

      {/* The bottom rule closes the mobile disclosure list. On desktop the
          blocks are open spec-sheet rows and the last one needs no terminator
          beyond the section rule that follows. */}
      <div className="mt-7 border-b border-[var(--mach-ink)]/12 lg:mt-8 lg:border-b-0">
        {detailRows.length > 0 && (
          <DetailBlock title="Product Details" defaultOpen={firstOpen()}>
            <SpecList rows={detailRows} />
          </DetailBlock>
        )}

        {hasFacts && (
          <DetailBlock title="Supplement Facts" defaultOpen={firstOpen()}>
            <div className={MEASURE_LABEL}>
              {servingRows.length > 0 && (
                <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1">
                  {servingRows.map((r) => (
                    <div key={r.label} className="flex items-baseline gap-2">
                      <dt
                        className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${MUTE}`}>
                        {r.label}
                      </dt>
                      <dd className={`text-[13px] font-bold ${INK}`}>
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <SupplementFactsPanel rows={facts} />
            </div>
          </DetailBlock>
        )}

        {prose.ingredients && (
          <DetailBlock title="Ingredients" defaultOpen={firstOpen()}>
            <Prose body={prose.ingredients} />
          </DetailBlock>
        )}

        {prose.directions && (
          <DetailBlock title="Directions" defaultOpen={firstOpen()}>
            <Prose body={prose.directions} />
          </DetailBlock>
        )}

        {prose.warnings && (
          <DetailBlock title="Warnings" defaultOpen={firstOpen()}>
            {/* Set apart by a rule and a step up in contrast — enough that it
                cannot be mistaken for marketing copy, without colour, an icon
                or a panel making it look like an alert. The text itself is
                rendered exactly as entered. */}
            <p
              className={`whitespace-pre-line border-s-2 border-[var(--mach-ink)]/25 ps-4 text-[15px] leading-relaxed text-[var(--mach-ink)]/80 ${MEASURE_PROSE}`}>
              {prose.warnings}
            </p>
          </DetailBlock>
        )}

        {longDescription && (
          <DetailBlock title="Description" defaultOpen={firstOpen()}>
            <p
              className={`whitespace-pre-line text-[16px] leading-[1.75] ${MUTE} ${MEASURE_PROSE}`}>
              {longDescription}
            </p>
          </DetailBlock>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Block bodies                                                      */
/* ------------------------------------------------------------------ */

function Prose({ body }: { body: string }) {
  return (
    <p
      className={`whitespace-pre-line text-[15px] leading-relaxed ${MUTE} ${MEASURE_PROSE}`}>
      {body}
    </p>
  );
}

function SpecList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className={MEASURE_LABEL}>
      {rows.map((spec) => (
        <div
          key={spec.label}
          className="flex items-baseline justify-between gap-4 border-b border-[var(--mach-ink)]/10 py-2 first:pt-0 last:border-0 last:pb-0">
          <dt
            className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${MUTE}`}>
            {spec.label}
          </dt>
          <dd className={`text-sm font-bold ${INK}`}>{spec.value}</dd>
        </div>
      ))}
    </dl>
  );
}
