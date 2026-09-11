import { describe, it, expect } from "vitest";
import {
  buildCuratedSectionRequest,
  buildGroupProductRequests,
  groupSearchInput,
  orderByCmsSelection,
} from "../homepage-products";
import {
  SECTION_LABELS,
  type HomepageContent,
} from "#root/shared/types/homepage-content";
import { resolveGroupSections } from "#root/shared/types/homepage-group-sections";

/**
 * The four merchandising shelves are lists the client chose.
 *
 * Each one used to fall back to a catalogue query when nothing was picked — a
 * general product search for Best Sellers, `sortBy: "newest"` for New Drops,
 * `discountedOnly: true` for Offers. That made the sections dishonest in both
 * directions: a shelf the client had never touched filled itself up and looked
 * curated, and clearing a selection put the fallback back on the page instead
 * of taking the section off it.
 *
 * These pin the replacement, and the empty case is the one that matters: no
 * selection means no request, which means the row renders nothing.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const E = "eeeeeeee-0000-4000-8000-000000000005";
const F = "ffffffff-0000-4000-8000-000000000006";
const G = "abababab-0000-4000-8000-000000000007";
const H = "cdcdcdcd-0000-4000-8000-000000000008";

/* ------------------------------------------------------------------ */
/*  Identity                                                          */
/* ------------------------------------------------------------------ */

describe("merchandising section identity", () => {
  it("keeps the four storage keys behind their canonical names", () => {
    // The names changed; the keys never did. Renaming storage to match the
    // wording would strand every existing store's content.
    expect(SECTION_LABELS.featuredProducts).toBe("Best Sellers");
    expect(SECTION_LABELS.newArrivals).toBe("New Drops");
    expect(SECTION_LABELS.featuredShelf).toBe("Featured");
    expect(SECTION_LABELS.discountedProducts).toBe("Offers");
  });
});

/* ------------------------------------------------------------------ */
/*  Curated product source                                            */
/* ------------------------------------------------------------------ */

describe("buildCuratedSectionRequest", () => {
  it("queries exactly the selected ids, and only those", () => {
    expect(buildCuratedSectionRequest([A, B], false)).toEqual({
      limit: 2,
      includeOutOfStock: false,
      productIds: [A, B],
    });
  });

  it("issues no request at all when nothing is selected", () => {
    // `null`, not an empty query: there is nothing to ask for, so the section
    // renders nothing rather than being filled by whatever comes back.
    expect(buildCuratedSectionRequest([], false)).toBeNull();
    expect(buildCuratedSectionRequest(undefined, false)).toBeNull();
  });

  it("never carries a catalogue fallback of any kind", () => {
    const request = buildCuratedSectionRequest([A, B], true)!;

    expect("sortBy" in request).toBe(false);
    expect("discountedOnly" in request).toBe(false);
    expect("categoryIds" in request).toBe(false);
    expect(Object.keys(request).sort()).toEqual([
      "includeOutOfStock",
      "limit",
      "productIds",
    ]);
  });

  it("asks for exactly as many products as were picked", () => {
    expect(buildCuratedSectionRequest([A, B, C], true)!.limit).toBe(3);
  });

  it("keeps each shelf's own out-of-stock rule", () => {
    // Best Sellers and Offers hide sold-out products; New Drops and Featured
    // show them. Unchanged by this work.
    expect(buildCuratedSectionRequest([A], false)!.includeOutOfStock).toBe(false);
    expect(buildCuratedSectionRequest([A], true)!.includeOutOfStock).toBe(true);
  });

  it("ignores empty ids left behind by a cleared selection", () => {
    expect(buildCuratedSectionRequest(["", ""], false)).toBeNull();
  });
});

describe("each merchandising section, built the same way", () => {
  const content = {
    featuredProducts: { productIds: [A, B] },
    newArrivals: { productIds: [C, D] },
    featuredShelf: { productIds: [E, F] },
    discountedProducts: { productIds: [G, H] },
  };

  it("Best Sellers queries only its own selection", () => {
    const request = buildCuratedSectionRequest(
      content.featuredProducts.productIds,
      false,
    )!;
    expect(request.productIds).toEqual([A, B]);
  });

  it("New Drops queries only its own selection, never newest-first", () => {
    const request = buildCuratedSectionRequest(
      content.newArrivals.productIds,
      true,
    )!;
    expect(request.productIds).toEqual([C, D]);
    expect("sortBy" in request).toBe(false);
  });

  it("Featured queries only its own selection", () => {
    const request = buildCuratedSectionRequest(
      content.featuredShelf.productIds,
      true,
    )!;
    expect(request.productIds).toEqual([E, F]);
  });

  it("Offers queries only its own selection, never discounted-only", () => {
    const request = buildCuratedSectionRequest(
      content.discountedProducts.productIds,
      false,
    )!;
    expect(request.productIds).toEqual([G, H]);
    expect("discountedOnly" in request).toBe(false);
  });

  it("gives all four independent selections that can coexist", () => {
    const all = [
      buildCuratedSectionRequest(content.featuredProducts.productIds, false)!,
      buildCuratedSectionRequest(content.newArrivals.productIds, true)!,
      buildCuratedSectionRequest(content.featuredShelf.productIds, true)!,
      buildCuratedSectionRequest(content.discountedProducts.productIds, false)!,
    ];

    expect(all.map((r) => r.productIds)).toEqual([
      [A, B],
      [C, D],
      [E, F],
      [G, H],
    ]);
    // No product appears in two shelves — none of them borrows another's list.
    const every = all.flatMap((r) => r.productIds);
    expect(new Set(every).size).toBe(every.length);
  });

  it("leaves the others alone when one shelf is emptied", () => {
    expect(buildCuratedSectionRequest([], true)).toBeNull();
    expect(
      buildCuratedSectionRequest(content.featuredProducts.productIds, false)!
        .productIds,
    ).toEqual([A, B]);
    expect(
      buildCuratedSectionRequest(content.featuredShelf.productIds, true)!
        .productIds,
    ).toEqual([E, F]);
  });
});

/* ------------------------------------------------------------------ */
/*  Order                                                             */
/* ------------------------------------------------------------------ */

describe("CMS selection order", () => {
  it("renders products in the sequence the client chose", () => {
    // `product.search` returns rows in its own order, so without this the
    // picker would control which products appear but not their sequence.
    const rows = [{ id: B }, { id: A }, { id: C }];

    expect(orderByCmsSelection(rows, [C, A, B]).map((r) => r.id)).toEqual([
      C,
      A,
      B,
    ]);
  });

  it("drops a product that no longer exists rather than leaving a hole", () => {
    expect(
      orderByCmsSelection([{ id: A }], [A, B]).map((r) => r.id),
    ).toEqual([A]);
  });
});

/* ------------------------------------------------------------------ */
/*  Group safety                                                      */
/* ------------------------------------------------------------------ */

describe("group sections are untouched by any of this", () => {
  const GROUPS = [
    { id: "01a06245-0000-4000-8000-000000000001", name: "Supplements", slug: "supplements" },
  ];

  it("still queries a group by its category, never by product ids", () => {
    const sections = resolveGroupSections(
      { groupSections: [{ categoryId: GROUPS[0]!.id, enabled: true, limit: 4 }] },
      GROUPS,
    );
    const input = groupSearchInput(buildGroupProductRequests(sections)[0]!);

    expect(input.categoryIds).toEqual([GROUPS[0]!.id]);
    expect("productIds" in input).toBe(false);
  });

  it("cannot read a merchandising selection into a group request", () => {
    // The two paths share no field: a group request is built from the resolved
    // section, which carries a category and a limit and nothing else.
    const content = {
      groupSections: [{ categoryId: GROUPS[0]!.id, enabled: true, limit: 4 }],
      featuredProducts: { productIds: [A, B] },
      newArrivals: { productIds: [C, D] },
    } as unknown as HomepageContent;

    const requests = buildGroupProductRequests(
      resolveGroupSections(content, GROUPS),
    );

    expect(JSON.stringify(requests)).not.toContain(A);
    expect(JSON.stringify(requests)).not.toContain(C);
    expect(requests).toEqual([{ categoryId: GROUPS[0]!.id, limit: 4 }]);
  });
});
