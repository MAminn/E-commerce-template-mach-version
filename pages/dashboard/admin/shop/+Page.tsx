import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "#root/shared/trpc/client";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import { Switch } from "#root/components/ui/switch";
import { Textarea } from "#root/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#root/components/ui/card";
import { MediaSlotField } from "#root/components/admin/MediaSlotField";
import { HomepageCategoryPicker } from "#root/components/admin/HomepageCategoryPicker";
import { getStoreOwnerId } from "#root/shared/config/store";
import {
  DEFAULT_SHOP_CONTENT,
  mergeShopContentWithDefaults,
  type ShopContent,
} from "#root/shared/types/shop-content";
import { Loader2 } from "lucide-react";

/**
 * Shop Page CMS editor.
 *
 * Everything the shopper reads on /shop is edited here — the storefront
 * component holds no copy of its own. Consistent with the Mach homepage rule,
 * switching the hero off only unpublishes it: the media and text stay stored
 * and stay editable, so the client can toggle it back without re-entering
 * anything.
 */
export default function ShopContentAdminPage() {
  const merchantId = getStoreOwnerId();

  const [content, setContent] = useState<ShopContent>(DEFAULT_SHOP_CONTENT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    trpc.shopContent.getContent
      .query({ merchantId })
      .then((res) => {
        if (cancelled || !res.success) return;
        setContent(mergeShopContentWithDefaults(res.result));
      })
      .catch(() => toast.error("Failed to load shop content"))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  const patch = (next: Partial<ShopContent>) =>
    setContent((prev) => ({ ...prev, ...next }));

  const patchHero = (next: Partial<ShopContent["hero"]>) =>
    setContent((prev) => ({ ...prev, hero: { ...prev.hero, ...next } }));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await trpc.shopContent.updateContent.mutate({
        merchantId,
        content: content as any,
      });
      if (res.success) {
        setContent(mergeShopContentWithDefaults(res.result));
        toast.success("Shop page updated");
      } else {
        toast.error("Failed to update shop page");
      }
    } catch (err) {
      console.error("Failed to save shop content:", err);
      toast.error("Failed to update shop page");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-24'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    );
  }

  const heroDisabled = !content.hero.enabled;

  return (
    <div className='space-y-6 p-4 sm:p-6'>
      <div>
        <h1 className='text-2xl font-bold'>Shop Page</h1>
        <p className='text-sm text-muted-foreground'>
          Controls the content shown on /shop. Products and categories come from
          the catalogue — this is the surrounding copy and imagery.
        </p>
      </div>

      {/* ── Hero ── */}
      <Card>
        <CardHeader>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <CardTitle>Shop Hero</CardTitle>
              <CardDescription>
                Optional banner at the top of the shop. When switched off the
                storefront renders nothing at all — no empty space — and the
                heading moves up. Your text and images are kept.
              </CardDescription>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <Label htmlFor='hero-enabled' className='text-sm'>
                {content.hero.enabled ? "Published" : "Hidden"}
              </Label>
              <Switch
                id='hero-enabled'
                checked={content.hero.enabled}
                onCheckedChange={(v) => patchHero({ enabled: v })}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-5'>
          {heroDisabled && (
            <p className='rounded-md border border-dashed p-3 text-xs text-muted-foreground'>
              The hero is hidden from the storefront. You can still edit
              everything below and it will be there when you publish it again.
            </p>
          )}

          <MediaSlotField
            label='Hero media'
            hint='Desktop asset, with an optional dedicated mobile crop and alt text.'
            value={content.hero.media}
            onChange={(media) => patchHero({ media })}
            prefix='shop-hero'
          />

          <div className='space-y-2'>
            <Label htmlFor='hero-headline'>Headline</Label>
            <Input
              id='hero-headline'
              value={content.hero.headline ?? ""}
              onChange={(e) => patchHero({ headline: e.target.value })}
              placeholder='Leave blank to show no headline'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='hero-description'>Description</Label>
            <Textarea
              id='hero-description'
              className='resize-none'
              value={content.hero.description ?? ""}
              onChange={(e) => patchHero({ description: e.target.value })}
              placeholder='Leave blank to show no description'
            />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='hero-cta-label'>CTA label</Label>
              <Input
                id='hero-cta-label'
                value={content.hero.ctaLabel ?? ""}
                onChange={(e) => patchHero({ ctaLabel: e.target.value })}
                placeholder='e.g. Shop Protein'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='hero-cta-href'>CTA link</Label>
              <Input
                id='hero-cta-href'
                value={content.hero.ctaHref ?? ""}
                onChange={(e) => patchHero({ ctaHref: e.target.value })}
                placeholder='e.g. /categories/proten'
              />
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>
            The button only appears when both the label and the link are set.
          </p>
        </CardContent>
      </Card>

      {/* ── Top-level groups ── */}
      <Card>
        <CardHeader>
          <CardTitle>Top-Level Groups</CardTitle>
          <CardDescription>
            The broad groups offered as the shop&rsquo;s main filter row, in the
            order shoppers see them. &ldquo;All&rdquo; is always first and is
            added for you. Names come from Dashboard &rarr; Categories.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <HomepageCategoryPicker
            selectedIds={content.groupCategoryIds ?? []}
            onChange={(ids) => patch({ groupCategoryIds: ids })}
          />
          <p className='text-xs text-muted-foreground'>
            Leave this empty to offer every category. Use it when the catalogue
            contains groupings that should not appear as top-level filters — the
            shop stays product-first rather than turning into a category tree.
          </p>
        </CardContent>
      </Card>

      {/* ── Page copy ── */}
      <Card>
        <CardHeader>
          <CardTitle>Page Content</CardTitle>
          <CardDescription>
            Heading, intro and the wording used around the product grid. Leave a
            field blank to hide it.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div className='space-y-2'>
            <Label htmlFor='shop-heading'>Page heading</Label>
            <Input
              id='shop-heading'
              value={content.heading ?? ""}
              onChange={(e) => patch({ heading: e.target.value })}
              placeholder='e.g. PRODUCTS'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='shop-intro'>Page intro</Label>
            <Textarea
              id='shop-intro'
              className='resize-none'
              value={content.intro ?? ""}
              onChange={(e) => patch({ intro: e.target.value })}
              placeholder='Short paragraph under the heading'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='shop-empty'>Empty-state text</Label>
            <Input
              id='shop-empty'
              value={content.emptyStateText ?? ""}
              onChange={(e) => patch({ emptyStateText: e.target.value })}
              placeholder='Shown when a search or filter returns nothing'
            />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='count-singular'>Product count — singular</Label>
              <Input
                id='count-singular'
                value={content.countSingular ?? ""}
                onChange={(e) => patch({ countSingular: e.target.value })}
                placeholder='product'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='count-plural'>Product count — plural</Label>
              <Input
                id='count-plural'
                value={content.countPlural ?? ""}
                onChange={(e) => patch({ countPlural: e.target.value })}
                placeholder='products'
              />
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>
            Used by the counter in the toolbar, e.g. &ldquo;12 products&rdquo;.
          </p>
        </CardContent>
      </Card>

      <div className='flex justify-end'>
        <Button size='lg' onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save Shop Page"}
        </Button>
      </div>
    </div>
  );
}
