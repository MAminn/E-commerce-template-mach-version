import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "vike-react/useData";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  Save,
  Smartphone,
} from "lucide-react";
import { trpc } from "#root/shared/trpc/client";
import {
  DEFAULT_LANDING_PAGE_SETTINGS,
  LANDING_CTA_TEXT_MAX_LENGTH,
  LANDING_MEDIA_VIDEO_ENDPOINT,
  LANDING_PAGE_PATH,
  LANDING_PRODUCTS_TITLE_MAX_LENGTH,
  LANDING_SUBTITLE_MAX_LENGTH,
  LANDING_TITLE_MAX_LENGTH,
  validateLandingPageSettings,
  type LandingPageField,
  type LandingPageHero,
  type LandingPageSettings,
} from "#root/shared/landing-page/config";
import type { TextAlign, TextTheme, TextVerticalAlign } from "#root/shared/types/homepage-content";
import {
  MediaSlotField,
  MediaTextControls,
} from "#root/components/admin/MediaSlotField";
import type { MediaUploadTarget } from "#root/components/admin/uploadMediaFile";
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
import { Textarea } from "#root/components/ui/textarea";
import {
  LandingProductsEditor,
  type EditorProduct,
} from "./LandingProductsEditor";
import type { Data } from "./+data";

/**
 * Dashboard → Landing 2.
 *
 * Edits the content of the one fixed marketing page at /landing-2: its hero
 * and which catalogue products it shows, in what order. There is no way to
 * create, rename or remove pages here, and that is deliberate.
 */

/** Hero uploads go to the Landing 2 routes, which media buyers may use. */
const LANDING_UPLOAD_TARGET: MediaUploadTarget = {
  uploadFile: ({ file }) => trpc.landingPage.uploadImage.mutate({ file }),
  videoEndpoint: LANDING_MEDIA_VIDEO_ENDPOINT,
};

type FieldErrors = Partial<Record<LandingPageField, string>>;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className='text-xs text-destructive'>{message}</p>;
}

function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={`text-[11px] tabular-nums ${
        value.trim().length > max ? "text-destructive" : "text-muted-foreground"
      }`}>
      {value.trim().length}/{max}
    </span>
  );
}

export default function Landing2SettingsPage() {
  const loaded = useData<Data>();
  const initial = loaded.success
    ? loaded.result.settings
    : structuredClone(DEFAULT_LANDING_PAGE_SETTINGS);

  const [settings, setSettings] = useState<LandingPageSettings>(initial);
  const [saved, setSaved] = useState<LandingPageSettings>(initial);
  const [known, setKnown] = useState<Record<string, EditorProduct>>(() =>
    Object.fromEntries(
      (loaded.success ? loaded.result.selectedProducts : []).map((p) => [
        p.id,
        p,
      ]),
    ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<"mobile" | "desktop" | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const loadError = loaded.success ? null : loaded.error;

  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(saved),
    [settings, saved],
  );

  // Leaving with unsaved edits asks first.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const patchHero = (patch: Partial<LandingPageHero>) =>
    setSettings((prev) => ({ ...prev, hero: { ...prev.hero, ...patch } }));

  // The full address needs the browser's origin; the server renders the path.
  const [pageUrl, setPageUrl] = useState(LANDING_PAGE_PATH);
  useEffect(() => {
    setPageUrl(`${window.location.origin}${LANDING_PAGE_PATH}`);
  }, []);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy — select the link and copy it manually");
    }
  };

  const handleSave = async () => {
    const validation = validateLandingPageSettings(settings);
    if (!validation.ok) {
      setErrors(validation.errors);
      toast.error(Object.values(validation.errors)[0] ?? "Check the form");
      return;
    }
    setErrors({});
    setIsSaving(true);
    try {
      const res = await trpc.landingPage.updateSettings.mutate(
        validation.settings,
      );
      if (res.success) {
        setSettings(res.result);
        setSaved(res.result);
        setPreviewKey((k) => k + 1);
        toast.success("Landing page saved — live now");
      } else {
        toast.error(res.error);
      }
    } catch (error) {
      console.error("Landing page save failed:", error);
      toast.error("Could not save. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const hero = settings.hero;

  return (
    <div className='mx-auto max-w-3xl space-y-6 p-4 pb-0 md:p-6 md:pb-0 lg:p-8 lg:pb-0'>
      <div className='space-y-3'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Landing 2</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            The marketing landing page for ad campaigns. Edit the hero and
            choose the products; changes go live when you save.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2'>
          <code className='min-w-0 flex-1 truncate px-1 text-sm'>
            {pageUrl}
          </code>
          <Button type='button' variant='outline' size='sm' onClick={copyUrl}>
            <Copy className='mr-1 h-3.5 w-3.5' /> Copy link
          </Button>
          <Button type='button' variant='outline' size='sm' asChild>
            <a href={LANDING_PAGE_PATH} target='_blank' rel='noreferrer'>
              <ExternalLink className='mr-1 h-3.5 w-3.5' /> Open page
            </a>
          </Button>
        </div>
        {loadError && (
          <p className='rounded-md border border-destructive/40 p-3 text-sm text-destructive'>
            The saved settings could not be loaded ({loadError}). Reload the
            page before saving, or you may overwrite them.
          </p>
        )}
      </div>

      {/* ── Hero ── */}
      <Card>
        <CardHeader>
          <CardTitle>Hero</CardTitle>
          <CardDescription>
            Full-width image or video at the top of the page. Videos play
            muted and loop; add a poster frame so something shows while the
            video loads.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          <MediaSlotField
            label='Background'
            hint='Upload a wide desktop file, and optionally a portrait one for phones.'
            value={hero.media}
            onPatch={(patch) =>
              setSettings((prev) => ({
                ...prev,
                hero: { ...prev.hero, media: { ...prev.hero.media, ...patch } },
              }))
            }
            onChange={(media) => patchHero({ media })}
            prefix='landing'
            uploadTarget={LANDING_UPLOAD_TARGET}
            disabled={isSaving}
          />
          <FieldError message={errors.media} />

          <div className='space-y-1.5'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor='landing-title'>Headline</Label>
              <CharCount value={hero.title} max={LANDING_TITLE_MAX_LENGTH} />
            </div>
            <Input
              id='landing-title'
              value={hero.title}
              disabled={isSaving}
              onChange={(e) => patchHero({ title: e.target.value })}
            />
            <FieldError message={errors.title} />
          </div>

          <div className='space-y-1.5'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor='landing-subtitle'>Subtitle</Label>
              <CharCount
                value={hero.subtitle}
                max={LANDING_SUBTITLE_MAX_LENGTH}
              />
            </div>
            <Textarea
              id='landing-subtitle'
              rows={2}
              value={hero.subtitle}
              disabled={isSaving}
              placeholder='Optional — a line under the headline'
              onChange={(e) => patchHero({ subtitle: e.target.value })}
            />
            <FieldError message={errors.subtitle} />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <div className='flex items-baseline justify-between'>
                <Label htmlFor='landing-cta-text'>Button text</Label>
                <CharCount
                  value={hero.ctaText}
                  max={LANDING_CTA_TEXT_MAX_LENGTH}
                />
              </div>
              <Input
                id='landing-cta-text'
                value={hero.ctaText}
                disabled={isSaving}
                placeholder='Leave empty for no button'
                onChange={(e) => patchHero({ ctaText: e.target.value })}
              />
              <FieldError message={errors.ctaText} />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='landing-cta-link'>Button link</Label>
              <Input
                id='landing-cta-link'
                value={hero.ctaLink}
                disabled={isSaving || !hero.ctaText.trim()}
                placeholder='#products'
                onChange={(e) => patchHero({ ctaLink: e.target.value })}
              />
              <p className='text-[11px] text-muted-foreground'>
                <code>#products</code> scrolls to the products below.
              </p>
              <FieldError message={errors.ctaLink} />
            </div>
          </div>

          <MediaTextControls
            align={hero.align}
            verticalAlign={hero.verticalAlign}
            textTheme={hero.textTheme}
            overlayOpacity={hero.overlayOpacity}
            disabled={isSaving}
            onChange={(next) =>
              patchHero({
                ...(next.align ? { align: next.align as TextAlign } : {}),
                ...(next.verticalAlign
                  ? { verticalAlign: next.verticalAlign as TextVerticalAlign }
                  : {}),
                ...(next.textTheme
                  ? { textTheme: next.textTheme as TextTheme }
                  : {}),
                ...(next.overlayOpacity !== undefined
                  ? { overlayOpacity: next.overlayOpacity }
                  : {}),
              })
            }
          />
        </CardContent>
      </Card>

      {/* ── Products ── */}
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>
            Pick existing products from the catalogue and set their order.
            Names, photos, prices and offers always come from the catalogue —
            edit those in Products.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div className='space-y-1.5'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor='landing-products-title'>Section heading</Label>
              <CharCount
                value={settings.productsTitle}
                max={LANDING_PRODUCTS_TITLE_MAX_LENGTH}
              />
            </div>
            <Input
              id='landing-products-title'
              value={settings.productsTitle}
              disabled={isSaving}
              placeholder='Optional — e.g. Shop the offer'
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  productsTitle: e.target.value,
                }))
              }
            />
            <FieldError message={errors.productsTitle} />
          </div>

          <LandingProductsEditor
            productIds={settings.productIds}
            known={known}
            disabled={isSaving}
            onChange={(productIds) =>
              setSettings((prev) => ({ ...prev, productIds }))
            }
            onLearn={(rows) =>
              setKnown((prev) => ({
                ...prev,
                ...Object.fromEntries(rows.map((r) => [r.id, r])),
              }))
            }
          />
          <FieldError message={errors.productIds} />
        </CardContent>
      </Card>

      {/* ── Preview ── */}
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            Shows the live page as shoppers see it — save first to preview
            your changes. Loading the preview counts as a page view in your
            pixels, like opening the page does.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex gap-2'>
            <Button
              type='button'
              size='sm'
              variant={preview === "mobile" ? "primary" : "outline"}
              onClick={() => setPreview("mobile")}>
              <Smartphone className='mr-1 h-3.5 w-3.5' /> Mobile
            </Button>
            <Button
              type='button'
              size='sm'
              variant={preview === "desktop" ? "primary" : "outline"}
              onClick={() => setPreview("desktop")}>
              <Monitor className='mr-1 h-3.5 w-3.5' /> Desktop
            </Button>
            {preview && (
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() => setPreview(null)}>
                Close
              </Button>
            )}
          </div>
          {preview && (
            <div className='overflow-hidden rounded-md border bg-muted/40'>
              <div
                className={`mx-auto ${
                  preview === "mobile"
                    ? "h-[740px] w-[390px] max-w-full"
                    : "h-[640px] w-full"
                }`}>
                <iframe
                  key={`${preview}-${previewKey}`}
                  title='Landing 2 preview'
                  src={LANDING_PAGE_PATH}
                  className='h-full w-full border-0 bg-white'
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Save bar ── */}
      <div className='sticky bottom-0 z-40 -mx-4 border-t bg-background/95 backdrop-blur md:-mx-6 lg:-mx-8'>
        <div className='flex items-center justify-between gap-3 px-4 py-3 md:px-6 lg:px-8'>
          <span className='text-sm text-muted-foreground'>
            {isDirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <div className='flex gap-2'>
            {isDirty && (
              <Button
                type='button'
                variant='outline'
                disabled={isSaving}
                onClick={() => {
                  setSettings(saved);
                  setErrors({});
                }}>
                Discard
              </Button>
            )}
            <Button
              type='button'
              onClick={handleSave}
              disabled={isSaving || !isDirty}>
              {isSaving ? (
                <Loader2 className='mr-1 h-4 w-4 animate-spin' />
              ) : (
                <Save className='mr-1 h-4 w-4' />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
