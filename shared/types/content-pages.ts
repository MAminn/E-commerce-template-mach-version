/**
 * Standalone CMS content pages — /about-us, /contact, /return-policy.
 *
 * These three routes are backed by `homepageContent.aboutUs`,
 * `homepageContent.contactBanner` and `homepageContent.returnPolicy`. Despite
 * living on the homepage content model they are *not* homepage sections: no
 * landing template renders them, and the admin cards are labelled "About Us
 * Page" / "Return Policy Page" / "Contact Page Banner & Content". `enabled` on
 * those three objects therefore means "this page is published", not "show this
 * strip on the homepage".
 *
 * The resolvers here are the single place that decides what a content page
 * shows. Both storefronts call them, so the Minimal and Mach renderings can
 * never disagree about whether a page is published or which locale's copy wins
 * — only about how it looks. Everything below is pure: no React, no DOM, no
 * database, which is what lets the route behaviour be tested directly.
 */

import type {
  HomepageAboutUsContent,
  HomepageContactBannerContent,
  HomepageReturnPolicyContent,
  HomepageReturnPolicyDetailSection,
  HomepageReturnPolicyStep,
  ValuePropIconType,
} from "./homepage-content";

export type ContentLocale = "en" | "ar";

/**
 * Picks the Arabic string when we're in Arabic and one was actually written,
 * otherwise the base string.
 *
 * Whitespace-only counts as unwritten: the CMS text inputs happily store " ",
 * and falling through to the English copy is better than a blank heading.
 */
function localized(
  locale: ContentLocale,
  base: string | undefined,
  arabic: string | undefined,
): string {
  if (locale === "ar" && arabic && arabic.trim()) return arabic;
  return base ?? "";
}

/**
 * Normalises a CMS image reference to something an `<img src>` can use.
 *
 * Stored values come in three shapes depending on which admin control wrote
 * them: an absolute URL, a root-relative path, or a bare filename from the
 * uploads directory.
 */
export function resolveContentImageUrl(
  raw: string | undefined,
): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return value;
  return `/uploads/${value}`;
}

/* ------------------------------------------------------------------ */
/*  About                                                             */
/* ------------------------------------------------------------------ */

export interface AboutPageView {
  title: string;
  /** Body split on blank/new lines — the CMS field is a plain textarea. */
  paragraphs: string[];
  imageUrl: string | null;
}

/**
 * Resolves /about-us.
 *
 * Returns `null` when the page is unpublished or has no body to show. A page
 * with a title and no copy is not a page, and inventing copy for it would put
 * words the client never wrote on their storefront.
 */
export function resolveAboutPage(
  about: HomepageAboutUsContent | undefined,
  locale: ContentLocale,
): AboutPageView | null {
  if (!about?.enabled) return null;

  const title = localized(locale, about.title, about.titleAr).trim();
  const description = localized(
    locale,
    about.description,
    about.descriptionAr,
  );

  const paragraphs = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!title || paragraphs.length === 0) return null;

  return {
    title,
    paragraphs,
    imageUrl: resolveContentImageUrl(about.imageUrl),
  };
}

/* ------------------------------------------------------------------ */
/*  Return policy                                                     */
/* ------------------------------------------------------------------ */

export interface ReturnPolicyStepView {
  icon: ValuePropIconType;
  title: string;
  description: string;
}

export interface ReturnPolicyDetailView {
  title: string;
  body: string;
}

export interface ReturnPolicyPageView {
  title: string;
  intro: string;
  steps: ReturnPolicyStepView[];
  detailSections: ReturnPolicyDetailView[];
  /**
   * The closing help line. `supportEmail` ships blank on purpose — the store
   * has to set a real address before we print one — so this is null until
   * there is either an address or a contact link to offer.
   */
  help: {
    prefix: string;
    supportEmail: string | null;
    middle: string;
    contactLink: { label: string; url: string } | null;
  } | null;
}

function stepView(
  step: HomepageReturnPolicyStep,
  locale: ContentLocale,
): ReturnPolicyStepView {
  return {
    icon: step.icon,
    title: localized(locale, step.title, step.titleAr),
    description: localized(locale, step.description, step.descriptionAr),
  };
}

function detailView(
  section: HomepageReturnPolicyDetailSection,
  locale: ContentLocale,
): ReturnPolicyDetailView {
  return {
    title: localized(locale, section.title, section.titleAr),
    body: localized(locale, section.body, section.bodyAr),
  };
}

/**
 * Resolves /return-policy.
 *
 * Returns `null` when unpublished, or when there is neither an intro nor a
 * single step or detail section — i.e. nothing that amounts to a policy.
 */
export function resolveReturnPolicyPage(
  policy: HomepageReturnPolicyContent | undefined,
  locale: ContentLocale,
): ReturnPolicyPageView | null {
  if (!policy?.enabled) return null;

  const title = localized(locale, policy.title, policy.titleAr).trim();
  const intro = localized(locale, policy.intro, policy.introAr).trim();
  const steps = (policy.steps ?? []).map((s) => stepView(s, locale));
  const detailSections = (policy.detailSections ?? []).map((s) =>
    detailView(s, locale),
  );

  if (!title) return null;
  if (!intro && steps.length === 0 && detailSections.length === 0) return null;

  const supportEmail = (policy.supportEmail ?? "").trim() || null;
  const contactUrl = (policy.contactLinkUrl ?? "").trim();
  const contactLabel = localized(
    locale,
    policy.contactLinkLabel,
    policy.contactLinkLabelAr,
  ).trim();
  const contactLink =
    contactUrl && contactLabel ? { label: contactLabel, url: contactUrl } : null;

  return {
    title,
    intro,
    steps,
    detailSections,
    help:
      supportEmail || contactLink
        ? {
            prefix: localized(
              locale,
              policy.footerPrefix,
              policy.footerPrefixAr,
            ),
            supportEmail,
            middle: localized(
              locale,
              policy.footerMiddle,
              policy.footerMiddleAr,
            ),
            contactLink,
          }
        : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Contact                                                           */
/* ------------------------------------------------------------------ */

export interface ContactPageView {
  heading: string;
  description: string;
  directionsUrl: string | null;
  /** Banner images, already normalised. Templates decide how many to use. */
  images: { id: string; imageUrl: string; mobileImageUrl: string | null; alt: string | null }[];
}

/**
 * Resolves /contact.
 *
 * Unlike About and Return Policy this never returns `null`: the page's reason
 * to exist is the form, which works whether or not the banner content has been
 * filled in. `contactBanner.enabled` governs the banner, and the headings fall
 * back to the shipped defaults so the page is never headless.
 */
export function resolveContactPage(
  banner: HomepageContactBannerContent | undefined,
  locale: ContentLocale,
): ContactPageView {
  const bannerOn = banner?.enabled !== false;

  const heading =
    localized(locale, banner?.heading, banner?.headingAr).trim() ||
    (locale === "ar" ? "نود أن نسمع منك" : "We Would Love To Hear From You");

  const images = bannerOn
    ? (banner?.slides ?? [])
        .map((slide) => ({
          id: slide.id,
          imageUrl: resolveContentImageUrl(slide.imageUrl),
          mobileImageUrl: resolveContentImageUrl(slide.mobileImageUrl),
          alt: (slide.alt ?? "").trim() || null,
        }))
        .filter(
          (slide): slide is ContactPageView["images"][number] =>
            slide.imageUrl !== null,
        )
    : [];

  return {
    heading,
    description: localized(
      locale,
      banner?.description,
      banner?.descriptionAr,
    ).trim(),
    directionsUrl: (banner?.directionsUrl ?? "").trim() || null,
    images,
  };
}
