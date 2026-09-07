import { Button } from "#root/components/ui/button";
import { Badge } from "#root/components/ui/badge";
import { ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import {
  CAMPAIGN_SECTION_PREFIX,
  SECTION_LABELS,
  resolveSectionOrder,
  type OrderableSectionKey,
} from "#root/shared/types/homepage-content";

/**
 * Reorders the homepage sections below the hero.
 *
 * The client moves a row up or down and the storefront renders in that order —
 * no deploy. The hero is not listed because it is pinned to the top: the
 * navbar's transparent-over-hero behaviour depends on it opening the page.
 *
 * Rows show whether each section is currently switched on, so it is obvious
 * why a section that has been moved still isn't visible on the site.
 */

/** Human label for one entry in the order, campaign banners included. */
function labelFor(key: string, content: HomepageContent): string {
  if (key.startsWith(CAMPAIGN_SECTION_PREFIX)) {
    const id = key.slice(CAMPAIGN_SECTION_PREFIX.length);
    const banner = content.campaignBanners?.find((b) => b.id === id);
    const title = banner?.title?.trim();
    return title ? `Campaign — ${title}` : "Campaign banner";
  }
  return SECTION_LABELS[key as OrderableSectionKey] ?? key;
}

/** Whether the section is currently enabled, for the on/off chip. */
function isEnabled(key: string, content: HomepageContent): boolean {
  if (key.startsWith(CAMPAIGN_SECTION_PREFIX)) {
    const id = key.slice(CAMPAIGN_SECTION_PREFIX.length);
    return Boolean(content.campaignBanners?.find((b) => b.id === id)?.enabled);
  }
  switch (key as OrderableSectionKey) {
    case "heroMarquee":
      return Boolean(content.heroMarquee?.enabled);
    case "stacks":
      return Boolean(content.stacks?.enabled);
    case "gymGear":
      return Boolean(content.gymGear?.enabled);
    case "featuredProducts":
      return content.featuredProducts.enabled;
    case "discountedProducts":
      return Boolean(content.discountedProducts?.enabled);
    case "newArrivals":
      return Boolean(content.newArrivals?.enabled);
    case "whyMach":
      return Boolean(content.whyMach?.enabled);
    case "certificates":
      return Boolean(content.certificates?.enabled);
    case "ugc":
      return Boolean(content.ugc?.enabled);
    case "newsletter":
      return content.newsletter.enabled;
    case "footerCta":
      return content.footerCta.enabled;
    default:
      return false;
  }
}

export function HomepageSectionOrder({
  content,
  onChange,
  disabled = false,
}: {
  content: HomepageContent;
  onChange: (order: string[]) => void;
  disabled?: boolean;
}) {
  // Always render the resolved order, not the raw saved array — that way a
  // section added after the client last saved appears in the list instead of
  // being invisible until they happen to re-save.
  const order = resolveSectionOrder(
    content.sectionOrder,
    (content.campaignBanners ?? []).map((b) => b.id),
  );

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item as string);
    onChange(next);
  };

  return (
    <div className='space-y-3'>
      <ul className='divide-y rounded-md border'>
        {order.map((key, index) => {
          const enabled = isEnabled(key, content);
          return (
            <li key={key} className='flex items-center gap-3 px-3 py-2.5'>
              <GripVertical className='h-4 w-4 shrink-0 text-muted-foreground/40' />
              <span className='w-5 shrink-0 text-xs tabular-nums text-muted-foreground'>
                {index + 1}
              </span>
              <span className='flex-1 truncate text-sm font-medium'>
                {labelFor(key, content)}
              </span>
              <Badge
                variant={enabled ? "secondary" : "outline"}
                className='shrink-0 text-[10px]'>
                {enabled ? "On" : "Off"}
              </Badge>
              <div className='flex shrink-0 items-center gap-0.5'>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7'
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${labelFor(key, content)} up`}>
                  <ChevronUp className='h-3.5 w-3.5' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7'
                  disabled={disabled || index === order.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${labelFor(key, content)} down`}>
                  <ChevronDown className='h-3.5 w-3.5' />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className='text-xs text-muted-foreground'>
        The hero always stays at the top of the page. Sections switched
        &ldquo;Off&rdquo;, and merchandising sections with no products yet, keep
        their position here but do not render on the site.
      </p>
    </div>
  );
}
