import { Button } from "#root/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#root/components/ui/card";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import { Switch } from "#root/components/ui/switch";
import { Textarea } from "#root/components/ui/textarea";
import { Slider } from "#root/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#root/components/ui/select";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import {
  MediaSlotField,
  MediaTextControls,
} from "#root/components/admin/MediaSlotField";
import { HomepageCategoryPicker } from "#root/components/admin/HomepageCategoryPicker";
import { HomepageProductPicker } from "#root/components/admin/HomepageProductPicker";
import { HomepageSectionOrder } from "#root/components/admin/HomepageSectionOrder";
import type {
  CampaignBannerContent,
  CertificateItem,
  GroupSectionPresentation,
  HeroMediaLayout,
  HomepageContent,
  HomepageGroupSectionContent,
  MediaSlot,
  ProductSectionDisplayMode,
  TextAlign,
  TextTheme,
  TextVerticalAlign,
  WhyMachItem,
} from "#root/shared/types/homepage-content";
import {
  DEFAULT_GROUP_SECTION_LIMIT,
  DEFAULT_GROUP_VIEW_ALL_TEXT,
  DEFAULT_NEW_DROPS_TITLE,
  EMPTY_MEDIA_SLOT,
  GROUP_SECTION_LIMIT_MAX,
  GROUP_SECTION_LIMIT_MIN,
  resolveProductSectionDisplayMode,
  ValuePropIconType,
} from "#root/shared/types/homepage-content";
import {
  normalizeGroupSections,
  resolveGroupSections,
  type ResolvedGroupSection,
} from "#root/shared/types/homepage-group-sections";
import { useBroadGroups } from "#root/components/admin/useBroadGroups";

/**
 * Homepage Admin editors for the Mach storefront sections.
 *
 * Kept out of the main Homepage Admin page — that file is already ~5k lines,
 * and inlining seven more section editors would make it unworkable. Each card
 * here is self-contained and takes the same `content` / `setContent` pair the
 * host page uses, so mounting one is a single line.
 */

type SetContent = (
  updater: (prev: HomepageContent) => HomepageContent,
) => void;

/* ------------------------------------------------------------------ */
/*  Display mode — shared by every product section                    */
/* ------------------------------------------------------------------ */

/**
 * Grid or carousel, for one product section.
 *
 * One control, mounted by the group sections and by all four merchandising
 * shelves. Written once deliberately: six copies of a two-option selector is
 * six chances for the wording, the default or the stored value to drift, and
 * the whole promise of this setting is that it means the same thing wherever
 * the client meets it.
 *
 * A section that has never been given a value is showing the grid — that is
 * what the storefront has always rendered — so the control reads `undefined`
 * as "Grid" rather than as "nothing selected".
 */
function MachDisplayModeField({
  value,
  onChange,
}: {
  value: ProductSectionDisplayMode | undefined;
  onChange: (next: ProductSectionDisplayMode) => void;
}) {
  const resolved = resolveProductSectionDisplayMode(value);
  return (
    <div className='space-y-1.5'>
      <Label className='text-xs'>Display</Label>
      <Select
        value={resolved}
        onValueChange={(v) => onChange(v as ProductSectionDisplayMode)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='grid'>Grid</SelectItem>
          <SelectItem value='carousel'>Carousel</SelectItem>
        </SelectContent>
      </Select>
      <p className='text-xs text-muted-foreground'>
        {resolved === "carousel"
          ? "Shows the same products in a horizontal swipeable row."
          : "Shows products in the standard section layout."}
      </p>
    </div>
  );
}

/** Stable id for a newly created repeater row. */
function newId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${suffix}`;
}

/** Moves an item within an array, returning a new array. */
function moved<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items];
  const target = index + delta;
  if (target < 0 || target >= next.length) return items;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Header row shared by every card: title, description, on/off switch. */
function SectionCardHeader({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <CardHeader>
      <div className='flex items-start justify-between gap-4'>
        <div className='min-w-0'>
          <CardTitle>{title}</CardTitle>
          <CardDescription className='mt-1'>{description}</CardDescription>
        </div>
        {/* Visibility controls publication only — the fields below stay
            editable while hidden so content can be prepared before it goes
            live. Cards under this header therefore do not gate their inputs on
            `enabled`; a disabled field would make the switch a lock, which is
            the behaviour this rule exists to avoid. */}
        <div className='flex shrink-0 items-center gap-2'>
          <Label
            className='text-xs text-muted-foreground'
            title={
              enabled
                ? "This section is live on the storefront."
                : "Hidden from the storefront. You can still edit and prepare it here."
            }>
            {enabled ? "Visible" : "Hidden"}
          </Label>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </div>
      </div>
    </CardHeader>
  );
}

/* ================================================================== */
/*  Hero — campaign media, second CTA, placement                      */
/* ================================================================== */

export function MachHeroCampaignCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const hero = content.hero;
  const patch = (next: Partial<typeof hero>) =>
    setContent((prev) => ({ ...prev, hero: { ...prev.hero, ...next } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hero Campaign Media</CardTitle>
        <CardDescription>
          The full-screen opener, built in two layers: the scene behind, and a
          product cut-out lit in front of it. Either layer can stand on its own
          — a scene with no product reads as a photographic campaign, a product
          with no scene reads as a studio shot on black. Both keep their real
          colour; the black and white belongs to the interface around them.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        <div className='space-y-2 rounded-lg border p-4'>
          <Label className='text-sm font-semibold'>Composition</Label>
          <Select
            value={hero.mediaLayout ?? "split"}
            onValueChange={(v) =>
              patch({ mediaLayout: v as HeroMediaLayout })
            }>
            <SelectTrigger className='h-9'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='split'>
                Split — copy left, media stage right
              </SelectItem>
              <SelectItem value='full-bleed'>
                Full bleed — one photo across the whole frame
              </SelectItem>
            </SelectContent>
          </Select>
          <p className='text-[11px] text-muted-foreground'>
            Split is the default and the one the campaign artwork is being
            made for. Choose full bleed only when a single photograph is the
            whole idea and cropping it into a column would waste it.
          </p>
        </div>

        <MediaSlotField
          label='Scene — background image or video'
          hint='The wide campaign shot behind everything. Shown at full colour — real packaging colour is the energy in this section. Upload a dedicated mobile crop too: a wide scene almost never works cropped to a phone.'
          prefix='hero'
          value={hero.media}
          onChange={(media) => patch({ media })}
        />

        <MediaSlotField
          label='Product cut-out — the hero focal point'
          hint='A pack shot on a transparent background (PNG or WebP). The template lights it and grounds it, so upload the product alone with no backdrop.'
          prefix='hero-product'
          imageOnly
          value={hero.productMedia}
          onChange={(productMedia) => patch({ productMedia })}
        />

        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-baseline justify-between'>
            <Label className='text-sm font-semibold'>Product size</Label>
            <span className='text-[11px] text-muted-foreground'>
              {hero.productScale ?? 100}%
            </span>
          </div>
          <Slider
            value={[hero.productScale ?? 100]}
            min={60}
            max={140}
            step={5}
            onValueChange={([v]) => patch({ productScale: v ?? 100 })}
          />
          <p className='text-[11px] text-muted-foreground'>
            Pack shots arrive framed very differently from one another. Use
            this to match a new one to the last without re-exporting the image.
          </p>
        </div>

        <MediaTextControls
          align={hero.align ?? "left"}
          verticalAlign={hero.verticalAlign ?? "bottom"}
          textTheme={hero.textTheme ?? "light"}
          overlayOpacity={hero.overlayOpacity ?? 55}
          onChange={(next) =>
            patch({
              align: (next.align as TextAlign) ?? hero.align,
              verticalAlign:
                (next.verticalAlign as TextVerticalAlign) ?? hero.verticalAlign,
              textTheme: (next.textTheme as TextTheme) ?? hero.textTheme,
              overlayOpacity: next.overlayOpacity ?? hero.overlayOpacity,
            })
          }
        />

        <div className='space-y-4 rounded-lg border p-4'>
          <Label className='text-sm font-semibold'>Secondary button</Label>
          <p className='text-xs text-muted-foreground'>
            Optional. Leave the label empty to show only the main button.
          </p>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label className='text-xs'>Label</Label>
              <Input
                value={hero.secondaryCtaText ?? ""}
                onChange={(e) => patch({ secondaryCtaText: e.target.value })}
                placeholder='e.g. Browse categories'
                className='h-9'
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-xs'>Destination</Label>
              <Input
                value={hero.secondaryCtaLink ?? ""}
                onChange={(e) => patch({ secondaryCtaLink: e.target.value })}
                placeholder='/shop'
                className='h-9'
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Marquee strip                                                     */
/* ================================================================== */

export function MachMarqueeCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const marquee = content.heroMarquee;
  if (!marquee) return null;

  const patch = (next: Partial<typeof marquee>) =>
    setContent((prev) => ({
      ...prev,
      heroMarquee: { ...prev.heroMarquee!, ...next },
    }));

  return (
    <Card>
      <SectionCardHeader
        title='Marquee Strip'
        description='A single line that scrolls continuously under the hero. Keep it short — it repeats across the full width.'
        enabled={marquee.enabled}
        onToggle={(enabled) => patch({ enabled })}
      />
      <CardContent className='space-y-4'>
        <div className='space-y-1.5'>
          <Label className='text-xs'>Text</Label>
          <Input
            value={marquee.text}
            onChange={(e) => patch({ text: e.target.value })}
            placeholder='e.g. Free delivery over EGP 1500'
            className='h-9'
          />
        </div>

        <div className='grid gap-3 sm:grid-cols-3'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Separator</Label>
            <Input
              value={marquee.separator ?? ""}
              onChange={(e) => patch({ separator: e.target.value })}
              placeholder='•'
              className='h-9'
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Direction</Label>
            <Select
              value={marquee.direction ?? "left"}
              onValueChange={(v) =>
                patch({ direction: v as "left" | "right" })
              }>
              <SelectTrigger className='h-9'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='left'>Right to left</SelectItem>
                <SelectItem value='right'>Left to right</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Style</Label>
            <Select
              value={marquee.invert ? "invert" : "normal"}
              onValueChange={(v) => patch({ invert: v === "invert" })}>
              <SelectTrigger className='h-9'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='invert'>White on black</SelectItem>
                <SelectItem value='normal'>Black on white</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='space-y-2'>
          <div className='flex items-baseline justify-between'>
            <Label className='text-xs'>Speed</Label>
            <span className='text-[11px] text-muted-foreground'>
              {marquee.speedSeconds ?? 28}s per pass
            </span>
          </div>
          <Slider
            value={[marquee.speedSeconds ?? 28]}
            min={8}
            max={90}
            step={2}
            onValueChange={([v]) => patch({ speedSeconds: v ?? 28 })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Broad group sections                                              */
/* ================================================================== */

/**
 * Editors for the store's broad group merchandising sections.
 *
 * One card per broad group, and the list of groups comes from the category
 * system rather than from this file. That is the whole point of the change it
 * replaces: there used to be a hard-coded card for Stacks & Bundles and
 * another for Gym Gear, so the store's third group — Supplements — had no
 * section at all, and a fourth would have needed a deploy. Now opening a broad
 * group in Dashboard → Categories is enough.
 *
 * The group *is* the category, so there is no source picker here. Changing
 * which category a section sells from would be changing which section it is,
 * and the two ways that could be expressed — renaming the card, or repointing
 * it — are exactly the confusion this architecture removes. What the client
 * can still do is override the copy, hand-pick the products, and choose how
 * the section presents itself.
 *
 * A group nobody has configured yet is off. Opening a catalogue group should
 * never change the live homepage by itself.
 */
export function MachGroupSectionsCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const { groups, loading } = useBroadGroups(content);
  const sections = resolveGroupSections(content, groups);

  /**
   * Writes one group's configuration.
   *
   * Normalised first, so a store still carrying the two legacy group rows gets
   * them converted on the client's first edit rather than keeping two
   * representations of the same section in the saved blob. Normalising also
   * drops the deprecated manual product override, so any edit here writes the
   * group back without it — the stale field cleans itself out of stored
   * content instead of needing a migration.
   */
  const patch = (
    categoryId: string,
    next: Partial<HomepageGroupSectionContent>,
  ) =>
    setContent((prev) => {
      const current = normalizeGroupSections(prev);
      const index = current.findIndex((s) => s.categoryId === categoryId);
      const base: HomepageGroupSectionContent =
        index >= 0
          ? current[index]!
          : { categoryId, enabled: false, presentation: "shelf" };
      const updated = { ...base, ...next, categoryId };
      const groupSections =
        index >= 0
          ? current.map((s, i) => (i === index ? updated : s))
          : [...current, updated];
      return { ...prev, groupSections };
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Group Sections</CardTitle>
        <CardDescription>
          A product section for each of your broad groups. The groups come from
          Dashboard → Categories — add one there and it appears here, switched
          off until you are ready for it.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        {loading && (
          <p className='text-sm text-muted-foreground'>Loading groups…</p>
        )}

        {!loading && sections.length === 0 && (
          <div className='rounded-md bg-muted p-3'>
            <p className='text-sm text-muted-foreground'>
              No broad groups yet. Add a category in Dashboard → Categories, or
              pick the groups for this homepage in the Shop by group card
              below, and each one gets its own section here.
            </p>
          </div>
        )}

        {sections.map((section) => (
          <MachGroupSectionEditor
            key={section.key}
            section={section}
            onPatch={(next) => patch(section.category.id, next)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/** One group's card. The category is fixed; everything here is an override. */
function MachGroupSectionEditor({
  section,
  onPatch,
}: {
  section: ResolvedGroupSection;
  onPatch: (next: Partial<HomepageGroupSectionContent>) => void;
}) {
  const config = section.config;
  const isCarousel = section.displayMode === "carousel";

  return (
    <div className='rounded-lg border p-4'>
      <div className='flex items-start justify-between gap-4'>
        <div className='min-w-0'>
          {/* The category's name, not the heading. This card is that group. */}
          <p className='truncate text-sm font-medium'>{section.category.name}</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            Sells from the {section.category.name} group. Products are pulled
            live, so adding a product to the group adds it here.
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Label
            className='text-xs text-muted-foreground'
            title={
              section.enabled
                ? "This section is live on the storefront."
                : "Hidden from the storefront. You can still edit and prepare it here."
            }>
            {section.enabled ? "Visible" : "Hidden"}
          </Label>
          <Switch
            checked={section.enabled}
            onCheckedChange={(v) => onPatch({ enabled: v })}
          />
        </div>
      </div>

      <div className='mt-4 space-y-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Storefront heading</Label>
            <Input
              value={config?.title ?? ""}
              onChange={(e) => onPatch({ title: e.target.value })}
              placeholder={section.category.name}
            />
            <p className='text-xs text-muted-foreground'>
              Leave blank to use the group's own name. Renaming it changes only
              what shoppers read — the section keeps its place and its name in
              Section Order.
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Sub-heading</Label>
            <Input
              value={config?.subtitle ?? ""}
              onChange={(e) => onPatch({ subtitle: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Link label</Label>
            <Input
              value={config?.viewAllText ?? ""}
              onChange={(e) => onPatch({ viewAllText: e.target.value })}
              placeholder={DEFAULT_GROUP_VIEW_ALL_TEXT}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Link destination</Label>
            <Input
              value={config?.viewAllLink ?? ""}
              onChange={(e) => onPatch({ viewAllLink: e.target.value })}
              placeholder={`/categories/${section.category.slug}`}
            />
            <p className='text-xs text-muted-foreground'>
              Leave blank to send shoppers to the group's own page.
            </p>
          </div>
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <MachDisplayModeField
            value={config?.displayMode}
            onChange={(displayMode) => onPatch({ displayMode })}
          />
          <div className='space-y-1.5'>
            <Label className='text-xs'>Presentation</Label>
            <Select
              value={section.presentation}
              /* Disabled, not hidden, and never cleared. Presentation is how
                 the section lays out in Grid; a carousel is one row of cards
                 whatever it says. Leaving the control visible with its stored
                 value shows the client what Grid will go back to, and stops
                 them changing a setting that would appear to do nothing. */
              disabled={isCarousel}
              onValueChange={(v) =>
                onPatch({ presentation: v as GroupSectionPresentation })
              }>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='shelf'>Product shelf</SelectItem>
                <SelectItem value='feature'>Feature panels</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              {isCarousel
                ? "Presentation applies to Grid mode. This setting is kept, and comes back if you switch Display to Grid."
                : "Product shelf is the standard row. Feature panels compose for a group that carries two or three items on purpose, like bundles."}
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Products shown</Label>
            <Input
              type='number'
              min={GROUP_SECTION_LIMIT_MIN}
              max={GROUP_SECTION_LIMIT_MAX}
              className='max-w-[8rem]'
              value={section.limit}
              onChange={(e) =>
                onPatch({
                  limit: Math.min(
                    GROUP_SECTION_LIMIT_MAX,
                    Math.max(
                      GROUP_SECTION_LIMIT_MIN,
                      Number.parseInt(e.target.value, 10) ||
                        DEFAULT_GROUP_SECTION_LIMIT,
                    ),
                  ),
                })
              }
            />
            <p className='text-xs text-muted-foreground'>
              How many of this group's products the homepage shows.
            </p>
          </div>
        </div>

        {/* No product picker, deliberately. The section is the category, so
            its contents are the category's contents — a hand-picked list here
            would go stale the moment a product was added to the group. */}
        <div className='space-y-1.5'>
          <Label className='text-xs'>Products</Label>
          <p className='text-xs text-muted-foreground'>
            Automatically pulled from the {section.category.name} group. Add or
            remove products from that category in Dashboard → Products.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Merchandising sections — the four curated shelves                 */
/* ================================================================== */

/**
 * The four merchandising shelves, in one place.
 *
 * Best Sellers, New Drops, Featured and Offers are not categories. They are
 * editorial selections cut across the whole catalogue, and on Mach the client
 * curates all four by hand — which is the distinction the homepage now rests
 * on: a **group** section shows whatever is in its category, a **merchandising**
 * section shows whatever the client picked.
 *
 * Two problems this card exists to fix.
 *
 * The first is that three of the four used to fall back to a catalogue query
 * when nothing was picked — a general product search, newest-first, or every
 * discounted product. That reads as helpful and behaves as a trap: the client
 * cannot tell a shelf they filled from one the database filled for them, and
 * clearing a selection puts the fallback back on the page instead of taking
 * the section off it. All four are now exactly what was chosen, and nothing
 * when nothing was.
 *
 * The second is that their editors were scattered through a five-thousand-line
 * admin page under their internal names — "Featured Products Section" for Best
 * Sellers, "New Arrivals" for New Drops, "Discounted Products (Offers)" for
 * Offers — so the client had to know the storage keys to find the row they were
 * looking at. Here they appear once each, under the names used everywhere else
 * in the CMS and on the storefront.
 *
 * The storage keys are unchanged: `featuredProducts`, `newArrivals`,
 * `featuredShelf` and `discountedProducts` still hold exactly what they held.
 * Renaming them would strand every existing store's content for a wording
 * problem, and the wording problem is solved by naming things properly here.
 */
export function MachMerchandisingSectionsCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Merchandising Sections</CardTitle>
        <CardDescription>
          Four shelves you fill yourself, separate from the product groups
          above. Each one shows exactly the products you choose for it, in the
          order you choose — and stays off the storefront until you pick some.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <MachCuratedShelfEditor
          name='Best Sellers'
          description='Choose the products shown in the Best Sellers shelf.'
          shelf={content.featuredProducts}
          onPatch={(next) =>
            setContent((prev) => ({
              ...prev,
              featuredProducts: {
                ...prev.featuredProducts,
                ...next,
              },
            }))
          }
        />

        <MachCuratedShelfEditor
          name='New Drops'
          description='Choose the products shown in the New Drops shelf.'
          shelf={content.newArrivals}
          onPatch={(next) =>
            setContent((prev) => ({
              ...prev,
              newArrivals: {
                ...(prev.newArrivals ?? {
                  enabled: true,
                  title: DEFAULT_NEW_DROPS_TITLE,
                  viewAllText: "VIEW ALL",
                  viewAllLink: "/shop",
                }),
                ...next,
              },
            }))
          }
        />

        <MachCuratedShelfEditor
          name='Featured'
          description='Choose the products shown in the Featured shelf.'
          shelf={content.featuredShelf}
          onPatch={(next) =>
            setContent((prev) => ({
              ...prev,
              featuredShelf: {
                ...(prev.featuredShelf ?? {
                  enabled: false,
                  title: "FEATURED",
                  viewAllText: "VIEW ALL",
                  viewAllLink: "/shop",
                }),
                ...next,
              },
            }))
          }
        />

        <MachCuratedShelfEditor
          name='Offers'
          description='Choose the products shown in the Offers shelf.'
          shelf={content.discountedProducts}
          onPatch={(next) =>
            setContent((prev) => ({
              ...prev,
              discountedProducts: {
                ...(prev.discountedProducts ?? {
                  enabled: true,
                  title: "OFFERS",
                  viewAllText: "VIEW ALL",
                  viewAllLink: "/shop",
                }),
                ...next,
              },
            }))
          }
        />
      </CardContent>
    </Card>
  );
}

/**
 * What every curated shelf stores, whichever key it lives under.
 *
 * The four sections have slightly different content types — only some declare
 * a subtitle, only Offers declares a limit — but everything this editor
 * touches is common to all of them, so one editor serves all four and they
 * cannot drift apart in what the client is able to control.
 */
interface CuratedShelfContent {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  viewAllText?: string;
  viewAllLink?: string;
  productIds?: string[];
  displayMode?: ProductSectionDisplayMode;
}

/**
 * What an empty selection means for a curated shelf.
 *
 * Shared by all four so the answer cannot drift between them, and worded as
 * the consequence rather than the state: "no products selected" is something
 * the client can already see, and what they need to know is that the section
 * will not be on the site.
 */
const EMPTY_CURATED_SHELF_MESSAGE =
  "No products selected — this section will not appear on the storefront.";

/** One merchandising shelf's controls. */
function MachCuratedShelfEditor({
  name,
  description,
  shelf,
  onPatch,
}: {
  name: string;
  description: string;
  shelf: CuratedShelfContent | undefined;
  onPatch: (next: Partial<CuratedShelfContent>) => void;
}) {
  const enabled = shelf?.enabled ?? false;
  const selectedProductIds = shelf?.productIds ?? [];

  return (
    <div className='rounded-lg border p-4'>
      <div className='flex items-start justify-between gap-4'>
        <div className='min-w-0'>
          {/* The canonical name, the same one Section Order and the rest of
              the CMS use. The storage key is never shown to the client. */}
          <p className='truncate text-sm font-medium'>{name}</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>{description}</p>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Label
            className='text-xs text-muted-foreground'
            title={
              enabled
                ? "This section is live on the storefront."
                : "Hidden from the storefront. You can still edit and prepare it here."
            }>
            {enabled ? "Visible" : "Hidden"}
          </Label>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => onPatch({ enabled: v })}
          />
        </div>
      </div>

      <div className='mt-4 space-y-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={shelf?.title ?? ""}
              onChange={(e) => onPatch({ title: e.target.value })}
              placeholder={name}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Sub-heading</Label>
            <Input
              value={shelf?.subtitle ?? ""}
              onChange={(e) => onPatch({ subtitle: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Link label</Label>
            <Input
              value={shelf?.viewAllText ?? ""}
              onChange={(e) => onPatch({ viewAllText: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Link destination</Label>
            <Input
              value={shelf?.viewAllLink ?? ""}
              onChange={(e) => onPatch({ viewAllLink: e.target.value })}
              placeholder='/shop'
            />
          </div>
          <MachDisplayModeField
            value={shelf?.displayMode}
            onChange={(displayMode) => onPatch({ displayMode })}
          />
        </div>

        <div className='space-y-2'>
          <Label className='text-xs'>Products</Label>
          <p className='text-xs text-muted-foreground'>
            Shown in the order you set here.
          </p>
          {/* The picker's own empty state carries the consequence, so it is
              stated once, next to the control that changes it. All four
              shelves are curated outright — there is no fallback to describe. */}
          <HomepageProductPicker
            selectedIds={selectedProductIds}
            onChange={(ids) => onPatch({ productIds: ids })}
            emptyMessage={EMPTY_CURATED_SHELF_MESSAGE}
          />
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Category selection                                                */
/* ================================================================== */

/**
 * Drives the broad-group discovery band under the Mach hero: which groups get
 * a tile, in what order, and how many run across a desktop row. The tile's
 * name, slug and artwork stay owned by the category system.
 */

export function MachCategorySelectionCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const categories = content.categories;
  const patch = (next: Partial<typeof categories>) =>
    setContent((prev) => ({
      ...prev,
      categories: { ...prev.categories, ...next },
    }));

  const enabled = categories.enabled ?? true;

  return (
    <Card>
      <SectionCardHeader
        title='Shop by Group'
        description='The broad groups shown as full-width tiles under the hero, and their order. Each tile&rsquo;s name and artwork come from Dashboard → Categories; a group with no artwork borrows a picture from one of its own products until you upload one.'
        enabled={enabled}
        onToggle={(v) => patch({ enabled: v })}
      />
      <CardContent className='space-y-5'>
        <HomepageCategoryPicker
          selectedIds={categories.categoryIds ?? []}
          onChange={(ids) => patch({ categoryIds: ids })}
        />

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={categories.title ?? ""}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder='Leave empty for tiles only'
            />
            <p className='text-xs text-muted-foreground'>
              Clear this and the sub-heading to run the tiles straight under the
              hero with no header above them.
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Sub-heading</Label>
            <Input
              value={categories.subtitle ?? ""}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Tile link label</Label>
            <Input
              value={categories.ctaText ?? ""}
              onChange={(e) => patch({ ctaText: e.target.value })}
              placeholder='e.g. SHOP NOW'
            />
            <p className='text-xs text-muted-foreground'>
              Shown under the name on every tile. Each tile links to its own
              group page.
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Tiles per row (desktop)</Label>
            <Select
              value={categories.layoutVariant ?? "tiles-4"}
              onValueChange={(v) => patch({ layoutVariant: v as any })}>
              <SelectTrigger className='h-9'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='tiles-4'>Up to four across</SelectItem>
                <SelectItem value='tiles-3'>Up to three across</SelectItem>
                <SelectItem value='tiles-2'>Two across (largest)</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              A ceiling, not a target — fewer groups than this simply fill the
              row.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Campaign banners                                                  */
/* ================================================================== */

export function MachCampaignBannersCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const banners = content.campaignBanners ?? [];

  const setBanners = (next: CampaignBannerContent[]) =>
    setContent((prev) => ({ ...prev, campaignBanners: next }));

  const patchBanner = (id: string, next: Partial<CampaignBannerContent>) =>
    setBanners(banners.map((b) => (b.id === id ? { ...b, ...next } : b)));

  const addBanner = () =>
    setBanners([
      ...banners,
      {
        id: newId("campaign"),
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
      },
    ]);

  return (
    <Card>
      <CardHeader>
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0'>
            <CardTitle>Campaign Banners</CardTitle>
            <CardDescription className='mt-1'>
              Full-width lifestyle breaks between product rows. Position each
              one using &ldquo;Section Order&rdquo; below. A banner with no
              image does not appear on the site.
            </CardDescription>
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={addBanner}
            className='shrink-0'>
            <Plus className='mr-1.5 h-3.5 w-3.5' /> Add banner
          </Button>
        </div>
      </CardHeader>
      <CardContent className='space-y-6'>
        {banners.length === 0 && (
          <p className='text-sm italic text-muted-foreground'>
            No campaign banners yet.
          </p>
        )}

        {banners.map((banner, index) => (
          <div key={banner.id} className='space-y-5 rounded-lg border p-4'>
            <div className='flex items-center justify-between gap-3 border-b pb-3'>
              <span className='truncate text-sm font-semibold'>
                {banner.title?.trim() || `Banner ${index + 1}`}
              </span>
              <div className='flex shrink-0 items-center gap-2'>
                <Label className='text-xs text-muted-foreground'>
                  {banner.enabled ? "Visible" : "Hidden"}
                </Label>
                <Switch
                  checked={banner.enabled}
                  onCheckedChange={(enabled) =>
                    patchBanner(banner.id, { enabled })
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8 text-destructive'
                  onClick={() =>
                    setBanners(banners.filter((b) => b.id !== banner.id))
                  }
                  aria-label='Delete banner'>
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            </div>

            <MediaSlotField
              label='Banner media'
              hint='Required — a banner is the photograph.'
              prefix='campaign'
              value={banner.media}
              onChange={(media) => patchBanner(banner.id, { media })}
            />

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Eyebrow</Label>
                <Input
                  value={banner.eyebrow ?? ""}
                  onChange={(e) =>
                    patchBanner(banner.id, { eyebrow: e.target.value })
                  }
                  className='h-9'
                />
              </div>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Headline</Label>
                <Input
                  value={banner.title}
                  onChange={(e) =>
                    patchBanner(banner.id, { title: e.target.value })
                  }
                  className='h-9'
                />
              </div>
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs'>Supporting copy</Label>
              <Textarea
                value={banner.body ?? ""}
                rows={2}
                onChange={(e) =>
                  patchBanner(banner.id, { body: e.target.value })
                }
              />
            </div>

            <div className='grid gap-3 sm:grid-cols-3'>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Button label</Label>
                <Input
                  value={banner.ctaText ?? ""}
                  onChange={(e) =>
                    patchBanner(banner.id, { ctaText: e.target.value })
                  }
                  className='h-9'
                />
              </div>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Button destination</Label>
                <Input
                  value={banner.ctaLink ?? ""}
                  onChange={(e) =>
                    patchBanner(banner.id, { ctaLink: e.target.value })
                  }
                  placeholder='/shop'
                  className='h-9'
                />
              </div>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Height</Label>
                <Select
                  value={banner.height ?? "standard"}
                  onValueChange={(v) =>
                    patchBanner(banner.id, { height: v as "standard" | "tall" })
                  }>
                  <SelectTrigger className='h-9'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='standard'>Standard</SelectItem>
                    <SelectItem value='tall'>Tall</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <MediaTextControls
              align={banner.align ?? "left"}
              verticalAlign={banner.verticalAlign ?? "bottom"}
              textTheme={banner.textTheme ?? "light"}
              overlayOpacity={banner.overlayOpacity ?? 45}
              onChange={(next) =>
                patchBanner(banner.id, {
                  align: (next.align as TextAlign) ?? banner.align,
                  verticalAlign:
                    (next.verticalAlign as TextVerticalAlign) ??
                    banner.verticalAlign,
                  textTheme: (next.textTheme as TextTheme) ?? banner.textTheme,
                  overlayOpacity: next.overlayOpacity ?? banner.overlayOpacity,
                })
              }
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Why Mach                                                          */
/* ================================================================== */

const ICON_OPTIONS = Object.values(ValuePropIconType);

export function MachWhyCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const why = content.whyMach;
  if (!why) return null;

  const patch = (next: Partial<typeof why>) =>
    setContent((prev) => ({ ...prev, whyMach: { ...prev.whyMach!, ...next } }));

  const setItems = (items: WhyMachItem[]) => patch({ items });
  const patchItem = (id: string, next: Partial<WhyMachItem>) =>
    setItems(why.items.map((i) => (i.id === id ? { ...i, ...next } : i)));

  return (
    <Card>
      <SectionCardHeader
        title='Why Mach'
        description='The trust pillars below the product rows. Keep claims to what you can evidence — no medical or performance claims.'
        enabled={why.enabled}
        onToggle={(enabled) => patch({ enabled })}
      />
      <CardContent className='space-y-5'>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Eyebrow</Label>
            <Input
              value={why.subtitle}
              onChange={(e) => patch({ subtitle: e.target.value })}
              className='h-9'
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={why.title}
              onChange={(e) => patch({ title: e.target.value })}
              className='h-9'
            />
          </div>
        </div>

        <div className='space-y-4'>
          {why.items.map((item, index) => (
            <div key={item.id} className='space-y-3 rounded-lg border p-4'>
              <div className='flex items-center justify-between gap-3'>
                <span className='truncate text-sm font-semibold'>
                  {item.title?.trim() || `Pillar ${index + 1}`}
                </span>
                <div className='flex shrink-0 items-center gap-0.5'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    disabled={index === 0}
                    onClick={() => setItems(moved(why.items, index, -1))}
                    aria-label='Move up'>
                    <ChevronUp className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    disabled={index === why.items.length - 1}
                    onClick={() => setItems(moved(why.items, index, 1))}
                    aria-label='Move down'>
                    <ChevronDown className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 text-destructive'
                    onClick={() =>
                      setItems(why.items.filter((i) => i.id !== item.id))
                    }
                    aria-label='Delete pillar'>
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>

              <div className='grid gap-3 sm:grid-cols-3'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Figure</Label>
                  <Input
                    value={item.stat ?? ""}
                    onChange={(e) =>
                      patchItem(item.id, { stat: e.target.value })
                    }
                    placeholder='01'
                    className='h-9'
                  />
                </div>
                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Title</Label>
                  <Input
                    value={item.title}
                    onChange={(e) =>
                      patchItem(item.id, { title: e.target.value })
                    }
                    className='h-9'
                  />
                </div>
              </div>

              <div className='space-y-1.5'>
                <Label className='text-xs'>Description</Label>
                <Textarea
                  value={item.description}
                  rows={2}
                  onChange={(e) =>
                    patchItem(item.id, { description: e.target.value })
                  }
                />
              </div>

              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Icon</Label>
                  <Select
                    value={item.icon ?? ""}
                    onValueChange={(v) =>
                      patchItem(item.id, { icon: v as ValuePropIconType })
                    }>
                    <SelectTrigger className='h-9'>
                      <SelectValue placeholder='None' />
                    </SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map((icon) => (
                        <SelectItem key={icon} value={icon}>
                          {icon}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Image URL (optional)</Label>
                  <Input
                    value={item.imageUrl ?? ""}
                    onChange={(e) =>
                      patchItem(item.id, { imageUrl: e.target.value })
                    }
                    placeholder='/uploads/homepage/…'
                    className='h-9'
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            setItems([
              ...why.items,
              {
                id: newId("why"),
                icon: ValuePropIconType.QUALITY,
                stat: String(why.items.length + 1).padStart(2, "0"),
                title: "",
                description: "",
              },
            ])
          }>
          <Plus className='mr-1.5 h-3.5 w-3.5' /> Add pillar
        </Button>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Certificates + manufacturing                                      */
/* ================================================================== */

export function MachCertificatesCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const certificates = content.certificates;
  if (!certificates) return null;

  const patch = (next: Partial<typeof certificates>) =>
    setContent((prev) => ({
      ...prev,
      certificates: { ...prev.certificates!, ...next },
    }));

  const patchFactory = (next: Partial<typeof certificates.factory>) =>
    setContent((prev) => ({
      ...prev,
      certificates: {
        ...prev.certificates!,
        factory: { ...prev.certificates!.factory, ...next },
      },
    }));

  const setItems = (items: CertificateItem[]) => patch({ items });
  const patchItem = (id: string, next: Partial<CertificateItem>) =>
    setItems(certificates.items.map((i) => (i.id === id ? { ...i, ...next } : i)));

  /**
   * Certificate images go through the generic media path.
   *
   * `alt` reads from the item's own stored value, never from `title`. Deriving
   * it from the title made the alt input un-editable: the field was rebuilt
   * from `title` on every render, so a cleared box refilled itself and typed
   * text was thrown away. Alt text is its own CMS value; blank means blank.
   */
  const certificateSlot = (item: CertificateItem): MediaSlot => ({
    kind: "image",
    desktopUrl: item.thumbnailUrl,
    alt: item.alt ?? "",
  });

  return (
    <Card>
      <SectionCardHeader
        title='Certificates & Manufacturing'
        description='Your compliance certificates, and the link to your manufacturing facility. Upload your real documents and title each one exactly as it is issued — nothing here ships pre-filled, and the storefront never describes a certificate beyond what you type.'
        enabled={certificates.enabled}
        onToggle={(enabled) => patch({ enabled })}
      />
      <CardContent className='space-y-6'>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Eyebrow</Label>
            <Input
              value={certificates.subtitle}
              onChange={(e) => patch({ subtitle: e.target.value })}
              className='h-9'
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={certificates.title}
              onChange={(e) => patch({ title: e.target.value })}
              className='h-9'
            />
          </div>
        </div>

        {/* ── Certificates ── */}
        <div className='space-y-4'>
          <Label className='text-sm font-semibold'>Certificates</Label>

          {certificates.items.length === 0 && (
            <p className='text-sm italic text-muted-foreground'>
              No certificates added yet. The section stays off the storefront
              until you add one — you can prepare them here first and switch it
              to Visible when you are ready.
            </p>
          )}

          {certificates.items.map((item, index) => (
            <div key={item.id} className='space-y-4 rounded-lg border p-4'>
              <div className='flex items-center justify-between gap-3'>
                <span className='truncate text-sm font-semibold'>
                  {item.title?.trim() || `Certificate ${index + 1}`}
                </span>
                <div className='flex shrink-0 items-center gap-0.5'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    disabled={index === 0}
                    onClick={() =>
                      setItems(moved(certificates.items, index, -1))
                    }
                    aria-label='Move up'>
                    <ChevronUp className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    disabled={index === certificates.items.length - 1}
                    onClick={() => setItems(moved(certificates.items, index, 1))}
                    aria-label='Move down'>
                    <ChevronDown className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 text-destructive'
                    onClick={() =>
                      setItems(certificates.items.filter((i) => i.id !== item.id))
                    }
                    aria-label='Delete certificate'>
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>

              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Title</Label>
                  <Input
                    value={item.title}
                    onChange={(e) =>
                      patchItem(item.id, { title: e.target.value })
                    }
                    className='h-9'
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Issued by</Label>
                  <Input
                    value={item.issuer ?? ""}
                    onChange={(e) =>
                      patchItem(item.id, { issuer: e.target.value })
                    }
                    className='h-9'
                  />
                </div>
              </div>

              {/* Both halves of the slot are persisted. Writing back only
                  `desktopUrl` was the other half of the alt-text bug: whatever
                  the field emitted for `alt` was dropped on the floor. */}
              <MediaSlotField
                label='Certificate image'
                hint='The document itself. Shown at its own aspect ratio, and full size when a customer opens it.'
                prefix='certificate'
                imageOnly
                value={certificateSlot(item)}
                onChange={(slot) =>
                  patchItem(item.id, {
                    thumbnailUrl: slot.desktopUrl,
                    alt: slot.alt ?? "",
                  })
                }
              />

              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Document URL</Label>
                  <Input
                    value={item.documentUrl ?? ""}
                    onChange={(e) =>
                      patchItem(item.id, { documentUrl: e.target.value })
                    }
                    placeholder='/uploads/homepage/… (PDF or scan)'
                    className='h-9'
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>
                    Verification link (optional)
                  </Label>
                  <Input
                    value={item.externalUrl ?? ""}
                    onChange={(e) =>
                      patchItem(item.id, { externalUrl: e.target.value })
                    }
                    placeholder='https://…'
                    className='h-9'
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() =>
              setItems([
                ...certificates.items,
                {
                  id: newId("cert"),
                  title: "",
                  issuer: "",
                  thumbnailUrl: "",
                  alt: "",
                  documentUrl: "",
                  externalUrl: "",
                },
              ])
            }>
            <Plus className='mr-1.5 h-3.5 w-3.5' /> Add certificate
          </Button>
        </div>

        {/* ── Factory ── */}
        <div className='space-y-4 rounded-lg border p-4'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <Label className='text-sm font-semibold'>
                Manufacturing facility
              </Label>
              <p className='mt-1 text-xs text-muted-foreground'>
                The factory block shown beside the certificates.
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <Switch
                checked={certificates.factory.enabled}
                onCheckedChange={(enabled) => patchFactory({ enabled })}
              />
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={certificates.factory.heading}
              onChange={(e) => patchFactory({ heading: e.target.value })}
              className='h-9'
            />
          </div>

          <div className='space-y-1.5'>
            <Label className='text-xs'>Body</Label>
            <Textarea
              value={certificates.factory.body}
              rows={3}
              onChange={(e) => patchFactory({ body: e.target.value })}
            />
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label className='text-xs'>Link label</Label>
              <Input
                value={certificates.factory.linkLabel}
                onChange={(e) => patchFactory({ linkLabel: e.target.value })}
                className='h-9'
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-xs'>Link destination</Label>
              <Input
                value={certificates.factory.linkUrl}
                onChange={(e) => patchFactory({ linkUrl: e.target.value })}
                placeholder='https://…'
                className='h-9'
              />
            </div>
          </div>

          <MediaSlotField
            label='Facility image'
            hint='A real photograph of the facility.'
            prefix='factory'
            value={certificates.factory.media}
            onChange={(media) => patchFactory({ media })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Section order                                                     */
/* ================================================================== */

export function MachSectionOrderCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Section Order</CardTitle>
        <CardDescription>
          The order sections appear on the homepage. Move a row up or down and
          save — the change is live, no developer needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HomepageSectionOrder
          content={content}
          onChange={(sectionOrder) =>
            setContent((prev) => ({ ...prev, sectionOrder }))
          }
        />
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Newsletter + closing CTA                                          */
/* ================================================================== */

/**
 * Both sections render on the Mach homepage and both sit in Section Order, but
 * neither had an editor anywhere in Homepage Admin — their copy was only
 * reachable by editing the database. These two cards close that gap; the
 * content types, the save path and the storefront components are unchanged.
 */

export function MachNewsletterCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const newsletter = content.newsletter;
  const patch = (next: Partial<typeof newsletter>) =>
    setContent((prev) => ({
      ...prev,
      newsletter: { ...prev.newsletter, ...next },
    }));

  return (
    <Card>
      <SectionCardHeader
        title='Newsletter'
        description='The email capture block near the foot of the page.'
        enabled={newsletter.enabled}
        onToggle={(v) => patch({ enabled: v })}
      />
      <CardContent className='space-y-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={newsletter.title ?? ""}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Sub-heading</Label>
            <Input
              value={newsletter.subtitle ?? ""}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Field placeholder</Label>
            <Input
              value={newsletter.placeholderText ?? ""}
              onChange={(e) => patch({ placeholderText: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Button label</Label>
            <Input
              value={newsletter.ctaText ?? ""}
              onChange={(e) => patch({ ctaText: e.target.value })}
            />
          </div>
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>Privacy line</Label>
          <Input
            value={newsletter.privacyText ?? ""}
            onChange={(e) => patch({ privacyText: e.target.value })}
          />
          <p className='text-xs text-muted-foreground'>
            The small print under the field. Leave empty to hide it.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function MachClosingCtaCard({
  content,
  setContent,
}: {
  content: HomepageContent;
  setContent: SetContent;
}) {
  const footerCta = content.footerCta;
  const patch = (next: Partial<typeof footerCta>) =>
    setContent((prev) => ({
      ...prev,
      footerCta: { ...prev.footerCta, ...next },
    }));

  return (
    <Card>
      <SectionCardHeader
        title='Closing CTA'
        description='The last block before the footer.'
        enabled={footerCta.enabled}
        onToggle={(v) => patch({ enabled: v })}
      />
      <CardContent className='space-y-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Heading</Label>
            <Input
              value={footerCta.title ?? ""}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Sub-heading</Label>
            <Input
              value={footerCta.subtitle ?? ""}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Button label</Label>
            <Input
              value={footerCta.ctaText ?? ""}
              onChange={(e) => patch({ ctaText: e.target.value })}
            />
          </div>
          <div className='space-y-1.5'>
            <Label className='text-xs'>Button link</Label>
            <Input
              value={footerCta.ctaLink ?? ""}
              onChange={(e) => patch({ ctaLink: e.target.value })}
              placeholder='/shop'
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
