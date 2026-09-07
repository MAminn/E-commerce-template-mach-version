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
 *
 * Visually it is treated as what it is — a label. The facts table and the
 * spec list sit in a bordered panel on paper, set apart from the prose beside
 * them, so a shopper scanning for dose and servings finds a block that looks
 * like the back of the tub rather than more page copy.
 */

function hasText(v?: string): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const MUTE = "text-[var(--mach-mute)]";
const INK = "text-[var(--mach-ink)]";
const LABEL =
  "text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)]";

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
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full min-w-[18rem] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-[var(--mach-ink)]">
            <th
              className={`py-2 pe-3 text-start text-[10px] font-bold uppercase tracking-[0.16em] ${INK}`}>
              Amount Per Serving
            </th>
            <th className="px-3 py-2" />
            {showDailyValue && (
              <th
                className={`whitespace-nowrap py-2 ps-3 text-end text-[10px] font-bold uppercase tracking-[0.16em] ${INK}`}>
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
                className={`py-2 pe-3 ${INK} ${
                  row.indent ? "ps-5 font-normal" : "font-semibold"
                }`}>
                {row.label}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-end font-semibold ${INK}`}>
                {hasText(row.amount) ? row.amount : ""}
              </td>
              {showDailyValue && (
                <td className={`whitespace-nowrap py-2 ps-3 text-end ${MUTE}`}>
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
/*  Full details panel                                                */
/* ------------------------------------------------------------------ */

function Block({ title, body }: { title: string; body?: string }) {
  if (!hasText(body)) return null;
  return (
    <div>
      <p className={LABEL}>{title}</p>
      <p className={`mt-2 whitespace-pre-line text-sm leading-relaxed ${MUTE}`}>
        {body}
      </p>
    </div>
  );
}

/**
 * Whole supplement-information section. Renders nothing at all when the
 * product carries no supplement data, so non-supplement products and legacy
 * catalogue rows are unaffected.
 */
export function SupplementDetailsPanel({
  info,
  sku,
  sectionHeading,
  className = "",
}: {
  info?: SupplementInfo | null;
  sku?: string | null;
  /** Section heading from product-page CMS content. Omitted → no heading. */
  sectionHeading?: string;
  className?: string;
}) {
  if (!info) return null;

  const specs: { label: string; value: string }[] = [
    { label: "SKU", value: sku ?? "" },
    { label: "Net Weight", value: info.netWeight ?? "" },
    { label: "Serving Size", value: info.servingSize ?? "" },
    { label: "Servings Per Container", value: info.servingsPerContainer ?? "" },
  ].filter((r) => hasText(r.value));

  const facts = (info.supplementFacts ?? []).filter((r) => hasText(r.label));
  const badges = (info.badges ?? []).filter(hasText);

  const isEmpty =
    specs.length === 0 &&
    facts.length === 0 &&
    badges.length === 0 &&
    !hasText(info.detailsHeading) &&
    !hasText(info.longDescription) &&
    !hasText(info.ingredients) &&
    !hasText(info.directions) &&
    !hasText(info.warnings);

  if (isEmpty) return null;

  // The label panel only earns its own column when there is label data in it,
  // AND there is prose to sit beside. With an entered label but no written
  // copy — which is the normal state early in a catalogue build — a two-column
  // grid leaves a body-height hole where the prose would go, so the panel just
  // stacks under the heading at a readable measure instead.
  const hasPanel = specs.length > 0 || facts.length > 0;
  const hasProse =
    badges.length > 0 ||
    hasText(info.longDescription) ||
    hasText(info.ingredients) ||
    hasText(info.directions) ||
    hasText(info.warnings);
  const twoColumn = hasPanel && hasProse;

  const prose = (
    <div className="space-y-7">
      {hasText(info.detailsHeading) && (
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--mach-mute)]">
          {info.detailsHeading}
        </p>
      )}

      {hasText(info.longDescription) && (
        <p
          className={`whitespace-pre-line text-[15px] leading-relaxed ${MUTE}`}>
          {info.longDescription}
        </p>
      )}

      <SupplementBadges badges={badges} />

      <Block title="Ingredients" body={info.ingredients} />
      <Block title="Directions" body={info.directions} />
      <Block title="Warnings" body={info.warnings} />
    </div>
  );

  return (
    <section
      className={`border-t border-[var(--mach-ink)]/12 pt-12 ${className}`}>
      {hasText(sectionHeading) && (
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black uppercase leading-[0.95] tracking-[-0.02em] text-[var(--mach-ink)]">
          {sectionHeading}
        </h2>
      )}

      <div
        className={`mt-8 grid gap-10 ${
          twoColumn ? "lg:grid-cols-[1fr_minmax(20rem,26rem)] lg:gap-14" : ""
        }`}>
        {prose}

        {hasPanel && (
          <aside
            className={`h-fit border border-[var(--mach-ink)] bg-[var(--mach-paper)] p-6 ${
              twoColumn ? "" : "max-w-2xl"
            }`}>
            {specs.length > 0 && (
              <dl className="space-y-2.5">
                {specs.map((spec) => (
                  <div
                    key={spec.label}
                    className="flex items-baseline justify-between gap-4 border-b border-[var(--mach-ink)]/10 pb-2.5 last:border-0 last:pb-0">
                    <dt
                      className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${MUTE}`}>
                      {spec.label}
                    </dt>
                    <dd className={`text-sm font-bold ${INK}`}>{spec.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {facts.length > 0 && (
              <div className={specs.length > 0 ? "mt-7" : ""}>
                <p className={LABEL}>Supplement Facts</p>
                <SupplementFactsPanel rows={facts} className="mt-3" />
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
