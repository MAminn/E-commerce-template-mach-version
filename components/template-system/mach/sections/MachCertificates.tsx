import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type {
  CertificateItem,
  HomepageCertificatesContent,
} from "#root/shared/types/homepage-content";
import { isMediaSlotEmpty } from "#root/shared/types/homepage-content";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import { StaggerContainer, StaggerItem } from "../../motion/Stagger";
import { MachMedia, normalizeMediaUrl } from "../MachMedia";
import {
  CTA_ON_DARK,
  EYEBROW,
  GUTTER,
  HEADING_SM,
  HEADING_TRUST,
  SHELL,
} from "../machTokens";

/**
 * Certificates and manufacturing trust.
 *
 * Two blocks the client owns end to end: their compliance certificates, and a
 * manufacturing block linking to the factory.
 *
 * **A certificate is a document, not a logo.** The previous treatment laid the
 * items out as a five-across strip of 80px-tall landscape cells, which is the
 * shape of a row of accreditation *badges*. A real certificate is a portrait
 * A4 page: dropped into that strip it rendered 45px wide beside four empty
 * cells — unreadable, and reading as placeholder media rather than as the
 * trust asset it is. So the presentation is driven by the document's own
 * proportions now: the image is given a generous height ceiling and takes
 * whatever width its aspect ratio asks for, inside a white page-like card.
 * Portrait, landscape or square, nothing is cropped or letterboxed.
 *
 * **Certificates render at full colour.** They were being desaturated and
 * dimmed to 70% to keep the storefront monochrome. That rule is for interface
 * chrome; an accreditation document is evidence, and restyling evidence is not
 * a design decision anyone should be making. Seals, accreditation marks and
 * issuer branding are how a shopper recognises the certificate as genuine.
 *
 * Clicking a certificate opens it full-screen so the document can actually be
 * read — the same uploaded file, at its own resolution and aspect ratio.
 * Where the client has also supplied a document file or an external
 * verification URL, that link is offered inside the viewer. Nothing here
 * invents a destination.
 *
 * Nothing here ships with content. Certificates are compliance evidence and
 * the factory is a real relationship — both must be the client's own material,
 * so the section stays hidden until they upload it rather than showing
 * placeholder seals that would misrepresent accreditation the store may not
 * hold. This component never states what a certificate certifies; every word
 * shown comes from the CMS item the client filled in.
 */

/* ------------------------------------------------------------------ */
/*  Layout                                                            */
/* ------------------------------------------------------------------ */

/**
 * How many documents run across a desktop row.
 *
 * A single certificate is centred and given the most room — one document is a
 * statement, and splitting the width to keep it in a grid would shrink it for
 * no reason. Beyond that the row fills out, capped at four so a page stays a
 * page rather than becoming a contact sheet.
 */
function columnsFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
}

/**
 * The card's width ceiling, by how many are on the row. This is the bound that
 * sizes the section: the card is capped and centred inside its grid column
 * rather than filling it, and the image takes whatever height its aspect ratio
 * asks for within that cap. Nothing is stretched, cropped or letterboxed.
 *
 * Width rather than height, because width is what the eye reads as the size of
 * a document on a page. The values include the card's own padding (`p-2`,
 * `sm:p-3`), so they run 16–24px above the artwork width they produce: the
 * common two-up case lands at ~250px of artwork on a desktop and ~220px on a
 * phone. A certificate is supporting evidence — big enough to recognise the
 * accreditation marks, small enough that the strip is not a screenful.
 */
function cardWidthFor(count: number): string {
  if (count <= 1) return "max-w-[256px] sm:max-w-[280px] lg:max-w-[310px]";
  if (count === 2) return "max-w-[236px] sm:max-w-[260px] lg:max-w-[274px]";
  return "max-w-[236px] sm:max-w-[240px] lg:max-w-[250px]";
}

/**
 * The document's height ceiling — a backstop, not the working bound.
 *
 * These sit just clear of what the current 852x1508 artwork needs at the width
 * caps above, so they never bind on it. They exist to catch an unusually tall
 * upload — a 1:3 banner at the same width would otherwise run past 800px and
 * set the section's height on its own — which simply renders narrower instead.
 *
 * Flat pixels, not the viewport-relative ceilings this used to carry: `56vh`
 * on a phone and `clamp(360px,26vw,480px)` on a desktop meant the documents
 * grew with the screen, which is what made the strip read as oversized on
 * exactly the sizes it was meant to feel compact on.
 */
function heightFor(count: number): string {
  if (count <= 1) return "max-h-[440px] sm:max-h-[470px] lg:max-h-[520px]";
  if (count === 2) return "max-h-[400px] sm:max-h-[430px] lg:max-h-[450px]";
  return "max-h-[400px] sm:max-h-[400px] lg:max-h-[410px]";
}

/**
 * Alt text for a certificate image, resolved at render time.
 *
 * The client's own alt text wins. Where they have not written any, the title
 * and then the issuer stand in, so the image is not left unlabelled just
 * because the field is untouched. This fallback belongs here and nowhere else:
 * the CMS form must show exactly what is stored, or the field cannot be edited
 * or cleared.
 */
function altFor(item: CertificateItem): string {
  return (
    item.alt?.trim() || item.title?.trim() || item.issuer?.trim() || ""
  );
}

/* ------------------------------------------------------------------ */
/*  Full-document viewer                                              */
/* ------------------------------------------------------------------ */

/**
 * Full-screen certificate viewer.
 *
 * Deliberately small: a fixed overlay, the same `<img>` the card renders, and
 * the three ways people expect to leave — the close control, the backdrop and
 * Escape. No focus-trap library, no portal, no new dependency; the section
 * needed the document to be readable, not a modal framework.
 */
function CertificateViewer({
  item,
  onClose,
}: {
  item: CertificateItem;
  onClose: () => void;
}) {
  const src = normalizeMediaUrl(item.thumbnailUrl);

  const documentHref = item.documentUrl?.trim()
    ? normalizeMediaUrl(item.documentUrl)
    : !isPlaceholderLink(item.externalUrl)
      ? item.externalUrl
      : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while the document is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const label = item.title?.trim() || item.issuer?.trim() || undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      /* Above the fixed navbar (z-10000) and its dropdowns (z-10001). At a
         lower layer the header sat on top of the overlay and covered the close
         control. */
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/85 p-4 sm:p-8">
      {/* Backdrop. A button rather than a click handler on the overlay so it
          is reachable without a pointer. */}
      <button
        type="button"
        aria-label={label ? `Close ${label}` : "Close"}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <div className="relative z-10 flex max-h-full flex-col items-center gap-4">
        {src && (
          <img
            src={src}
            alt={altFor(item)}
            className="max-h-[82vh] max-w-full object-contain"
          />
        )}

        {documentHref && (
          <a
            href={documentHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70 underline underline-offset-4 transition-colors hover:text-white">
            {item.title?.trim() || item.issuer?.trim() || documentHref}
          </a>
        )}
      </div>

      <button
        type="button"
        aria-label={label ? `Close ${label}` : "Close"}
        onClick={onClose}
        className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center border border-white/30 text-white transition-colors duration-300 hover:border-white hover:bg-white hover:text-[var(--mach-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-8 sm:top-8">
        <X className="h-5 w-5" strokeWidth={2} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                           */
/* ------------------------------------------------------------------ */

export function MachCertificates({
  content,
}: {
  content: HomepageCertificatesContent;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const items = content.items ?? [];
  const factory = content.factory;
  const factoryReady =
    Boolean(factory?.enabled) &&
    Boolean(factory?.heading?.trim() || factory?.body?.trim());

  const closeViewer = useCallback(() => setOpenId(null), []);

  // Both halves empty means the client hasn't supplied their documents yet.
  if (items.length === 0 && !factoryReady) return null;

  const factoryLinkHref = factory?.linkUrl;
  const showFactoryLink =
    Boolean(factory?.linkLabel?.trim()) && !isPlaceholderLink(factoryLinkHref);

  const openItem = items.find((i) => i.id === openId) ?? null;
  const columns = columnsFor(items.length);
  const cardWidth = cardWidthFor(items.length);
  const height = heightFor(items.length);

  return (
    <section
      id="trust"
      className="bg-[var(--mach-paper)] text-[var(--mach-ink)] scroll-mt-24">
      <div className={`${SHELL} ${GUTTER} py-8 sm:py-10 lg:py-12`}>
        {/* ── Certificates ── */}
        {items.length > 0 && (
          /* A credibility strip, not a merchandising row: the documents get
             their own, much narrower measure than the 1600px shell the rest of
             the page runs on. */
          <div className="mx-auto w-full max-w-[1100px]">
            {/* The header renders only what the client wrote. With both
                fields empty the documents stand on their own rather than
                sitting under an empty heading block. */}
            {(content.subtitle?.trim() || content.title?.trim()) && (
              <div className="mx-auto max-w-2xl text-center">
                {content.subtitle?.trim() && (
                  <p
                    className={`${EYEBROW} justify-center text-[var(--mach-ink)]/70`}>
                    <span
                      aria-hidden="true"
                      className="inline-block h-[2px] w-6 shrink-0 bg-[var(--mach-ink)]"
                    />
                    {content.subtitle}
                  </p>
                )}
                {content.title?.trim() && (
                  <h2 className={`mt-2.5 ${HEADING_TRUST}`}>{content.title}</h2>
                )}
              </div>
            )}

            {/* `w-fit` so the columns hug the documents instead of splitting
                the measure in half. Two 240px cards in two 550px columns left
                a 300px hole down the middle of the strip; fit-content still
                clamps to the available width, so a wide certificate cannot
                push the row past the measure. */}
            <StaggerContainer
              className={`mx-auto grid w-fit justify-items-center gap-x-8 gap-y-6 sm:gap-x-10 sm:gap-y-7 ${columns} ${
                content.subtitle?.trim() || content.title?.trim()
                  ? "mt-6 lg:mt-7"
                  : ""
              }`}>
              {items.map((item) => {
                const thumb = normalizeMediaUrl(item.thumbnailUrl);
                const label = item.title?.trim() || item.issuer?.trim();

                return (
                  <StaggerItem key={item.id} className="w-full">
                    <figure
                      className={`mx-auto flex h-full w-full flex-col items-center ${cardWidth}`}>
                      {/* The document. A white page on the paper ground with a
                          hairline and a soft lift, so it reads as a physical
                          certificate rather than as an image dropped on the
                          section. */}
                      {thumb ? (
                        <button
                          type="button"
                          onClick={() => setOpenId(item.id)}
                          aria-label={label}
                          className="group relative block cursor-zoom-in border border-[var(--mach-paper-line)] bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)] outline-none transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.06),0_20px_44px_-14px_rgba(0,0,0,0.26)] focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-paper)] sm:p-3">
                          {/* Full colour, natural aspect, never cropped: the
                              height is bounded and the width follows the
                              file. */}
                          <img
                            src={thumb}
                            alt={altFor(item)}
                            loading="lazy"
                            decoding="async"
                            className={`block h-auto w-auto max-w-full object-contain ${height}`}
                          />
                        </button>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="block h-40 w-32 border border-[var(--mach-ink)]/20 bg-white"
                        />
                      )}

                      {(item.title?.trim() || item.issuer?.trim()) && (
                        <figcaption className="mt-3 text-center">
                          {item.title?.trim() && (
                            <p className="text-[12px] font-bold uppercase leading-snug tracking-[0.14em]">
                              {item.title}
                            </p>
                          )}
                          {item.issuer?.trim() && (
                            <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--mach-mute)]">
                              {item.issuer}
                            </p>
                          )}
                        </figcaption>
                      )}
                    </figure>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </div>
        )}

        {/* ── Manufacturing / factory ──
            Unchanged, and still self-hiding: with no heading and no body there
            is nothing to say, so the block renders nothing rather than an
            empty half-width panel. */}
        {factoryReady && factory && (
          <div
            className={`grid grid-cols-1 items-stretch gap-px bg-[var(--mach-paper-line)] lg:grid-cols-2 ${
              items.length > 0 ? "mt-10 lg:mt-12" : ""
            }`}>
            <div className="flex flex-col justify-center bg-[var(--mach-ink)] p-8 text-white sm:p-12 lg:p-14">
              {factory.heading && (
                <h3 className={`${HEADING_SM} text-white`}>
                  {factory.heading}
                </h3>
              )}
              {factory.body && (
                <p className="mt-6 max-w-md text-[15px] leading-[1.75] text-white/60">
                  {factory.body}
                </p>
              )}
              {showFactoryLink && (
                <div className="mt-9">
                  <a
                    href={factoryLinkHref as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={CTA_ON_DARK}>
                    {factory.linkLabel}
                  </a>
                </div>
              )}
            </div>

            <div className="relative min-h-[280px] overflow-hidden bg-[var(--mach-paper-soft)] lg:min-h-[420px]">
              {!isMediaSlotEmpty(factory.media) ? (
                <MachMedia slot={factory.media} className="grayscale" />
              ) : (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[var(--mach-paper-soft)]"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {openItem && (
        <CertificateViewer item={openItem} onClose={closeViewer} />
      )}
    </section>
  );
}
