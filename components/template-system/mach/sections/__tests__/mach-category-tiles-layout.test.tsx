import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type HomepageCategoriesContent,
} from "#root/shared/types/homepage-content";
import type { CategoryStripItem } from "#root/components/shop/CategoryStrip";
import { MachCategoryTiles } from "../MachCategoryTiles";

/**
 * How the category band lays out at each breakpoint.
 *
 * Static markup, like the other Mach section tests: the layout is carried
 * entirely by utility classes, so asserting the classes is asserting the
 * layout. Phones (below `sm`) get one full-width tile per row; `sm` up to `lg`
 * keeps the two-up grid with an odd count's lead tile; `lg` keeps one row.
 */

function cat(n: number): CategoryStripItem {
  return {
    id: `cat-${n}`,
    name: `Group ${n}`,
    slug: `group-${n}`,
    imageUrl: `/uploads/categories/group-${n}.jpg`,
  };
}

function render(count: number, patch: Partial<HomepageCategoriesContent> = {}) {
  const categories = Array.from({ length: count }, (_, i) => cat(i + 1));
  const content: HomepageCategoriesContent = {
    ...(DEFAULT_HOMEPAGE_CONTENT.categories as HomepageCategoriesContent),
    categoryIds: categories.map((c) => c.id),
    ...patch,
  };
  return renderToStaticMarkup(
    <MachCategoryTiles content={content} categories={categories} />,
  );
}

/** The class list of the tile grid. */
function gridClasses(html: string): string[] {
  const found = html.match(/class="(grid w-full[^"]*)"/)?.[1];
  if (found === undefined) throw new Error("tile grid not found");
  return found.split(/\s+/);
}

/** The class list of every tile wrapper (the grid's direct children). */
function itemClasses(html: string): string[][] {
  const grid = html.match(
    /class="grid w-full[^"]*"[^>]*>([\s\S]*)<\/div><\/section>/,
  )?.[1];
  if (grid === undefined) throw new Error("tile grid not found");
  return [...grid.matchAll(/<div([^>]*)><a /g)].map((m) =>
    ((m[1] ?? "").match(/class="([^"]*)"/)?.[1] ?? "")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** The class list of every tile link. */
function linkClasses(html: string): string[][] {
  return [...html.matchAll(/<a href="\/categories\/[^"]*" class="([^"]*)"/g)].map(
    (m) => (m[1] ?? "").split(/\s+/),
  );
}

describe("MachCategoryTiles — phone layout (below sm)", () => {
  it("is a single column", () => {
    const classes = gridClasses(render(8));
    expect(classes).toContain("grid-cols-1");
    expect(classes).not.toContain("grid-cols-2");
  });

  it("never spans a tile across columns a phone does not have", () => {
    for (const count of [3, 5, 8]) {
      for (const item of itemClasses(render(count))) {
        expect(item).not.toContain("col-span-2");
      }
    }
  });

  it("gives every tile the same full-width 16:9 shape", () => {
    for (const link of linkClasses(render(5))) {
      expect(link).toContain("w-full");
      expect(link).toContain("aspect-16/9");
      expect(link).not.toContain("aspect-square");
    }
  });
});

describe("MachCategoryTiles — sm and up are unchanged", () => {
  it("keeps the two-up grid from sm", () => {
    expect(gridClasses(render(8))).toContain("sm:grid-cols-2");
  });

  it("still leads an odd selection with a full-width tile from sm to lg", () => {
    const items = itemClasses(render(5));
    expect(items[0]).toEqual(["sm:col-span-2", "lg:col-span-1"]);
    for (const item of items.slice(1)) expect(item).toEqual([]);

    const links = linkClasses(render(5));
    expect(links[0]).toContain("aspect-16/9");
    expect(links[0]).not.toContain("sm:aspect-square");
    for (const link of links.slice(1)) expect(link).toContain("sm:aspect-square");
  });

  it("has no lead tile for an even selection", () => {
    for (const item of itemClasses(render(4))) expect(item).toEqual([]);
  });

  it("keeps the desktop row and fixed tile height", () => {
    expect(gridClasses(render(3, { layoutVariant: "tiles-3" }))).toContain(
      "lg:grid-cols-3",
    );
    expect(gridClasses(render(8, { layoutVariant: "tiles-4" }))).toContain(
      "lg:grid-cols-4",
    );
    for (const link of linkClasses(render(4))) {
      expect(link).toContain("lg:aspect-auto");
      expect(link).toContain("lg:h-[clamp(360px,30vw,560px)]");
    }
  });
});

describe("MachCategoryTiles — content", () => {
  it("keeps every category's link, name and artwork, in order", () => {
    const html = render(3);
    expect([...html.matchAll(/href="(\/categories\/[^"]*)"/g)].map((m) => m[1])).toEqual([
      "/categories/group-1",
      "/categories/group-2",
      "/categories/group-3",
    ]);
    for (const n of [1, 2, 3]) {
      expect(html).toContain(`Group ${n}`);
      expect(html).toContain(`/uploads/categories/group-${n}.jpg`);
    }
  });
});
