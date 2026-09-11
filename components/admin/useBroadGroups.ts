import { useEffect, useMemo, useState } from "react";
import { trpc } from "#root/shared/trpc/client";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import {
  resolveBroadGroups,
  type BroadGroupCategory,
  type CategoryRecord,
} from "#root/shared/types/homepage-group-sections";

/**
 * The store's broad groups, for the Homepage Admin screens that list them.
 *
 * Both the Group Sections editor and Section Order need the same answer to the
 * same question — which categories are the store's broad groups, in which
 * order — and both need it to come from the live category system rather than
 * from anything saved in homepage content, so a group added this morning shows
 * up without a re-save.
 *
 * `loading` matters more than it looks. Section Order saves the resolved
 * order, and resolving it before the categories arrive would produce a list
 * with every group section missing — saving that would delete the client's
 * group placements. Callers render nothing until this settles.
 */
export function useBroadGroups(content: HomepageContent): {
  groups: BroadGroupCategory[];
  loading: boolean;
} {
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    trpc.category.view
      .query()
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.result)) {
          setCategories(
            (res.result as any[]).map((c) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              showOnLanding: c.showOnLanding,
              deleted: c.deleted,
            })),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Error loading categories:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Serialised so a new array identity from the content object — which is
  // rebuilt on every keystroke in Homepage Admin — does not recompute the list.
  const selectionKey = (content.categories?.categoryIds ?? []).join(",");
  const groups = useMemo(
    () =>
      resolveBroadGroups(
        categories,
        selectionKey ? selectionKey.split(",") : undefined,
      ),
    [categories, selectionKey],
  );

  return { groups, loading };
}
