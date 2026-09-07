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
  HEADING_FEATURE,
  HEADING_SM,
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
 * The document's height ceiling, by how many are on the row.
 *
 * Height rather than width, because height is the dimension a portrait page
 * needs bounded — the width then follows from the file's own aspect ratio. On
 * a phone the viewport height caps it instead, so a tall certificate takes
 * most of the screen's width without running past the fold.
 */
function heightFor(count: number): string {
  if (count <= 1) return "max-h-[68vh] lg:max-h-[clamp(420px,40vw,560px)]";
  if (count === 2) return "max-h-[56vh] lg:max-h-[clamp(360px,26vw,480px)]";
  return "max-h-[48vh] lg:max-h-[clamp(300px,20vw,400px)]";
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
  const height = heightFor(items.length);

  return (
    <section
      id="trust"
      className="bg-[var(--mach-paper)] text-[var(--mach-ink)] scroll-mt-24">
      <div
        className={`${SHELL} ${GUTTER} py-14 sm:py-16 lg:py-20`}>
        {/* ── Certificates ── */}
        {items.length > 0 && (
          <>
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
                  <h2 className={`mt-4 ${HEADING_FEATURE}`}>{content.title}</h2>
                )}
              </div>
            )}

            <StaggerContainer
              className={`mx-auto grid justify-items-center gap-8 sm:gap-10 ${columns} ${
                content.subtitle?.trim() || content.title?.trim()
                  ? "mt-10 lg:mt-12"
                  : ""
              }`}>
              {items.map((item) => {
                const thumb = normalizeMediaUrl(item.thumbnailUrl);
                const label = item.title?.trim() || item.issuer?.trim();

                return (
                  <StaggerItem key={item.id} className="w-full">
                    <figure className="flex h-full flex-col items-center">
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
                        <figcaption className="mt-5 text-center">
                          {item.title?.trim() && (
                            <p className="text-[12px] font-bold uppercase leading-snug tracking-[0.14em]">
                              {item.title}
                            </p>
                          )}
                          {item.issuer?.trim() && (
                            <p className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--mach-mute)]">
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
          </>
        )}

        {/* ── Manufacturing / factory ──
            Unchanged, and still self-hiding: with no heading and no body there
            is nothing to say, so the block renders nothing rather than an
            empty half-width panel. */}
        {factoryReady && factory && (
          <div
            className={`grid grid-cols-1 items-stretch gap-px bg-[var(--mach-paper-line)] lg:grid-cols-2 ${
              items.length > 0 ? "mt-14 lg:mt-16" : ""
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
