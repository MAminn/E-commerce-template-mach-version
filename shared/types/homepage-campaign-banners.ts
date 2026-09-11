import {
  CAMPAIGN_SECTION_PREFIX,
  EMPTY_MEDIA_SLOT,
  isMediaSlotEmpty,
  type CampaignBannerContent,
  type HomepageContent,
  type MediaSlot,
} from "./homepage-content";
import { isPlaceholderLink } from "./layout-settings";

/**
 * Campaign banner state transitions, as pure functions of saved CMS content.
 *
 * Every one of these used to live inside `MachCampaignBannersCard` as a
 * closure over the render's `content.campaignBanners`, computed there and then
 * committed through `setContent(prev => …)`. That is the bug this module
 * exists to remove: the array being written was read from a *previous* render
 * while the object it was written into was the *current* state, so anything
 * that landed in between was silently overwritten.
 *
 * The case that made it a client-visible fault is media. `MediaSlotField`
 * uploads asynchronously and a real campaign photograph takes seconds, so the
 * slot its completion handler closes over is always older than the state it
 * commits to. Uploading a desktop image and then a mobile crop before the
 * first finished wrote the mobile URL onto a slot whose `desktopUrl` was still
 * empty — the client watched their banner image disappear a second after it
 * appeared, with no error anywhere.
 *
 * Taking the transitions out of the component fixes that twice over: the card
 * can now apply each one to `prev` inside the updater, and the rules are
 * testable without rendering React.
 *
 * Nothing here knows about the storefront. A banner is CMS data; whether it
 * renders is `MachCampaignBanner`'s decision, and `campaignBannerStatus`
 * below only *reports* that decision so the admin cannot claim a banner is
 * visible when the storefront would drop it.
 */

/* ------------------------------------------------------------------ */
/*  Creation                                                          */
/* ------------------------------------------------------------------ */

/**
 * The starting record for a banner the client just added.
 *
 * Enabled, with an empty media slot. That pairing is deliberate and safe: a
 * banner without media renders nothing at all on the storefront, so switching
 * it on cannot put an empty black rectangle on the live page, and the client
 * does not have to remember a second switch after uploading their photograph.
 * The honest "no media yet" state is what the admin reports until they do —
 * see `campaignBannerStatus`.
 *
 * `ctaLink` starts empty rather than at a plausible-looking "/shop". An
 * unfilled destination must not become a live button, and an empty string is
 * the one value `isPlaceholderLink` and the renderer both already refuse.
 */
export function createCampaignBanner(id: string): CampaignBannerContent {
  return {
    id,
    enabled: true,
    media: { ...EMPTY_MEDIA_SLOT },
    eyebrow: "",
    title: "",
    body: "",
    ctaText: "",
    ctaLink: "",
    align: "left",
    verticalAlign: "bottom",
    textTheme: "light",
    overlayOpacity: 45,
    height: "standard",
  };
}

/**
 * Adds a banner, giving it an id nothing else in the content is using.
 *
 * The id factory is the caller's — Homepage Admin's `newId`, which is the
 * convention every other repeater row in that file already uses. This only
 * guarantees the result does not collide with a banner that already exists,
 * because the id is the banner's identity in `sectionOrder` and two banners
 * sharing one would make both unaddressable.
 */
export function addCampaignBanner(
  content: HomepageContent,
  makeId: () => string,
): HomepageContent {
  const banners = content.campaignBanners ?? [];
  const taken = new Set(banners.map((b) => b.id));

  let id = makeId();
  // Bounded: `newId` draws from crypto, so a collision is already
  // vanishingly unlikely and a second draw settles it. The counter is here so
  // a degenerate factory cannot spin this forever.
  for (let attempt = 0; taken.has(id) && attempt < 50; attempt += 1) {
    id = makeId();
  }
  if (taken.has(id)) {
    id = `${id}-${banners.length + 1}`;
  }

  return { ...content, campaignBanners: [...banners, createCampaignBanner(id)] };
}

/* ------------------------------------------------------------------ */
/*  Editing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Applies a partial edit to one banner, leaving every other banner untouched.
 *
 * An id that matches nothing is a no-op rather than an error: a delete and an
 * in-flight upload for the same banner can race, and losing the upload is the
 * correct outcome there — resurrecting a deleted banner is not.
 */
export function patchCampaignBanner(
  content: HomepageContent,
  id: string,
  patch: Partial<CampaignBannerContent>,
): HomepageContent {
  const banners = content.campaignBanners ?? [];
  return {
    ...content,
    campaignBanners: banners.map((banner) =>
      // `id` is reasserted last so a patch can never rewrite the identity the
      // section order addresses this banner by.
      banner.id === id ? { ...banner, ...patch, id: banner.id } : banner,
    ),
  };
}

/**
 * Merges a partial media change into one banner's slot.
 *
 * Separate from `patchCampaignBanner` because the whole point is that the
 * *slot* is merged too. A media edit arrives as a delta — "the desktop URL is
 * now this" — and is applied to whatever the slot holds at commit time, so a
 * mobile upload finishing after a desktop upload adds to it instead of
 * replacing it with the empty slot it was looking at when it started.
 */
export function patchCampaignBannerMedia(
  content: HomepageContent,
  id: string,
  patch: Partial<MediaSlot>,
): HomepageContent {
  const banners = content.campaignBanners ?? [];
  return {
    ...content,
    campaignBanners: banners.map((banner) =>
      banner.id === id
        ? {
            ...banner,
            media: { ...EMPTY_MEDIA_SLOT, ...banner.media, ...patch },
          }
        : banner,
    ),
  };
}

/* ------------------------------------------------------------------ */
/*  Removal                                                           */
/* ------------------------------------------------------------------ */

/** The `sectionOrder` entry addressing a banner. */
export function campaignSectionKey(id: string): string {
  return `${CAMPAIGN_SECTION_PREFIX}${id}`;
}

/**
 * Removes a banner and the section-order entry that addressed it.
 *
 * Both halves matter. `resolveSectionOrder` already refuses to render a
 * campaign key with no banner behind it, so leaving the entry in place was
 * never a storefront fault — but it meant the saved blob accumulated keys
 * pointing at banners that no longer existed, and the next person to read that
 * content by hand could not tell a live arrangement from a dead one. Removing
 * it here keeps stored content describing only what exists.
 *
 * Every other banner keeps its record and its position exactly as it was; ids
 * are never reassigned, so the banner below the deleted one does not inherit
 * its identity or its slot in the order.
 */
export function removeCampaignBanner(
  content: HomepageContent,
  id: string,
): HomepageContent {
  const banners = content.campaignBanners ?? [];
  const key = campaignSectionKey(id);

  return {
    ...content,
    campaignBanners: banners.filter((banner) => banner.id !== id),
    sectionOrder: content.sectionOrder?.filter((entry) => entry !== key),
  };
}

/* ------------------------------------------------------------------ */
/*  Call to action                                                    */
/* ------------------------------------------------------------------ */

/**
 * Schemes that must never reach a rendered `href`.
 *
 * A CMS destination is a free-text field an admin types into, so the value
 * arriving here is not guaranteed to be a navigation at all — `javascript:`
 * and `data:` both execute in the page's own origin when followed, which turns
 * a banner button into script injection carried in saved content. `vbscript:`
 * is dead everywhere current but costs one array entry to keep refused.
 */
const UNSAFE_LINK_SCHEMES = ["javascript:", "data:", "vbscript:"];

/**
 * True when a destination would execute rather than navigate.
 *
 * ASCII whitespace and C0 control characters are dropped before the scheme is
 * compared, because the URL parser drops them too: a destination written with
 * a tab or a newline inside the word `javascript` is still followed as
 * javascript by every browser, and would sail past a plain prefix check.
 */
export function isUnsafeLink(url: string | undefined | null): boolean {
  const collapsed = Array.from(url ?? "")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join("")
    .toLowerCase();
  return UNSAFE_LINK_SCHEMES.some((scheme) => collapsed.startsWith(scheme));
}

/**
 * The destination a banner's button should actually point at, or `null` when
 * it must not render as a button at all.
 *
 * Three conditions, all of which the client can produce from the CMS without
 * doing anything wrong:
 *
 *  - **No label.** A button with no words is not a call to action.
 *  - **No real destination.** Empty, `#` and the project's `#soon` sentinel
 *    are all "not decided yet" — `isPlaceholderLink` already owns that
 *    judgement and is shared with the chrome, so it is reused rather than
 *    restated.
 *  - **An unsafe scheme.** Refused outright; there is no banner design in
 *    which running script from a CMS text field is the intent.
 *
 * Returning the href rather than a boolean is what stops the renderer from
 * checking one thing and then rendering another.
 */
export function campaignBannerCtaHref(
  banner: Pick<CampaignBannerContent, "ctaText" | "ctaLink">,
): string | null {
  if (!banner.ctaText?.trim()) return null;
  const href = (banner.ctaLink ?? "").trim();
  if (isPlaceholderLink(href)) return null;
  if (isUnsafeLink(href)) return null;
  return href;
}

/* ------------------------------------------------------------------ */
/*  Status                                                            */
/* ------------------------------------------------------------------ */

/**
 * What one banner is actually doing on the storefront.
 *
 * Deliberately evaluates the same two conditions `MachCampaignBanner` returns
 * `null` on, in the same order, so the admin can never report a banner as
 * showing when the page would drop it. The admin used to read the switch alone
 * and print "Visible" next to a banner with no artwork — which is precisely
 * the state the client hits first, one click after Add banner, and precisely
 * the state that makes a working feature look broken.
 */
export type CampaignBannerStatus = "off" | "missing-media" | "visible";

export function campaignBannerStatus(
  banner: CampaignBannerContent,
): CampaignBannerStatus {
  if (!banner.enabled) return "off";
  if (isMediaSlotEmpty(banner.media)) return "missing-media";
  return "visible";
}

/** Badge text for `campaignBannerStatus`, in the client's vocabulary. */
export const CAMPAIGN_BANNER_STATUS_LABELS: Record<
  CampaignBannerStatus,
  string
> = {
  off: "Hidden",
  "missing-media": "No media",
  visible: "Visible",
};

/** What each status means for the live page, as a sentence. */
export const CAMPAIGN_BANNER_STATUS_HINTS: Record<
  CampaignBannerStatus,
  string
> = {
  off: "Switched off. It keeps its place in Section Order but does not appear on the site.",
  "missing-media":
    "Switched on, but no campaign media has been added — a banner is the photograph, so it does not appear on the site yet.",
  visible: "Appears on the site, in its Section Order position.",
};
