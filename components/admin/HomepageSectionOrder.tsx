import { Button } from "#root/components/ui/button";
import { Badge } from "#root/components/ui/badge";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import { resolveSectionOrder } from "#root/shared/types/homepage-content";
import {
  SECTION_STATUS_LABELS,
  describeSectionRows,
} from "#root/shared/types/homepage-section-rows";
import {
  groupCategoryIds,
  resolveGroupSections,
} from "#root/shared/types/homepage-group-sections";
import { useBroadGroups } from "./useBroadGroups";

/**
 * Reorders the homepage sections below the hero.
 *
 * The client moves a row up or down and the storefront renders in that order —
 * no deploy. The hero is not listed because it is pinned to the top: the
 * navbar's transparent-over-hero behaviour depends on it opening the page.
 *
 * Each row is named after what the section *is* — the category's name for a
 * broad group, the section's own name for everything else — with a renamed
 * storefront heading shown underneath, and carries the status the storefront
 * would give it rather than a plain on/off switch reading. See
 * `describeSectionRows`.
 *
 * The list is not a fixed set of rows. Every broad group has its own section
 * here, discovered from the category system, so a group the client opens turns
 * up as a row on the next load with no deploy and nothing to create by hand.
 *
 * Reordering is arrow-driven on purpose. There is no sortable library in this
 * repository, and a drag handle that does not drag is worse than no handle at
 * all.
 */
export function HomepageSectionOrder({
  content,
  onChange,
  disabled = false,
}: {
  content: HomepageContent;
  onChange: (order: string[]) => void;
  disabled?: boolean;
}) {
  const { groups, loading } = useBroadGroups(content);

  // Always render the resolved order, not the raw saved array — that way a
  // section added after the client last saved appears in the list instead of
  // being invisible until they happen to re-save.
  //
  // Resolving before the categories land would drop every group row, and this
  // list saves what it renders — so it waits rather than offering the client a
  // list that would delete their group placements the moment they pressed
  // Save.
  const groupSections = resolveGroupSections(content, groups);
  const order = resolveSectionOrder(
    content.sectionOrder,
    (content.campaignBanners ?? []).map((b) => b.id),
    groupCategoryIds(groups),
  );
  const rows = describeSectionRows(order, content, groupSections);

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item as string);
    onChange(next);
  };

  if (loading) {
    return (
      <p className='text-xs text-muted-foreground'>Loading page sections…</p>
    );
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs text-muted-foreground'>
        Use the arrows to reorder, then Save.
      </p>
      <ul className='divide-y rounded-md border'>
        {rows.map((row, index) => (
          <li key={row.key} className='flex items-center gap-3 px-3 py-2.5'>
            <span className='w-5 shrink-0 text-xs tabular-nums text-muted-foreground'>
              {index + 1}
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium'>
                {row.label}
              </span>
              {row.meta && (
                <span className='block truncate text-xs text-muted-foreground'>
                  {row.meta}
                </span>
              )}
            </span>
            <Badge
              variant={
                row.status === "visible" || row.status === "enabled"
                  ? "secondary"
                  : "outline"
              }
              className='shrink-0 text-[10px] font-normal'
              title={row.hint}>
              {SECTION_STATUS_LABELS[row.status]}
            </Badge>
            <div className='flex shrink-0 items-center gap-1'>
              <Button
                type='button'
                variant='outline'
                size='icon'
                className='h-7 w-7'
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${row.label} up`}>
                <ChevronUp className='h-4 w-4' />
              </Button>
              <Button
                type='button'
                variant='outline'
                size='icon'
                className='h-7 w-7'
                disabled={disabled || index === rows.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${row.label} down`}>
                <ChevronDown className='h-4 w-4' />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className='text-xs text-muted-foreground'>
        Each row is named after the section itself — a product group is named
        after its category — so the list stays recognisable when a heading is
        renamed on the storefront. The hero always stays at the top of the
        page, and a row keeps its position here whatever its status.{" "}
        <span className='font-medium'>Visible</span> means the section renders.{" "}
        <span className='font-medium'>Enabled</span> means it is switched on,
        but it fills itself from the catalogue when the page loads, so it still
        shows nothing if no products or categories come back. Hover any status
        for what it means.
      </p>
    </div>
  );
}
