import { PreviewHost } from "../../previews/PreviewHost";
import { mockCategoryProducts } from "../../previews/mockData";
import { SortingMachTemplate } from "./SortingMachTemplate";

/**
 * Admin thumbnail for the Mach shop template.
 *
 * Static and self-contained: the real template is fully controlled by its
 * route, so the preview supplies inert handlers and no CMS content. That is
 * deliberate — the thumbnail should show the structure, not whatever copy the
 * client happens to have saved.
 */
export function SortingMachPreview() {
  return (
    <PreviewHost>
      <SortingMachTemplate
        products={mockCategoryProducts}
        searchValue=""
        onSearchChange={() => {}}
        sortValue="featured"
        onSortChange={() => {}}
        filtersOpen={false}
        onToggleFilters={() => {}}
        inStockOnly={false}
        onInStockOnlyChange={() => {}}
        discountedOnly={false}
        onDiscountedOnlyChange={() => {}}
        totalProducts={mockCategoryProducts.length}
        page={1}
        totalPages={1}
        onPageChange={() => {}}
      />
    </PreviewHost>
  );
}
