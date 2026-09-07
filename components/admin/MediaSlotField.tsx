import { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "#root/shared/trpc/client";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import { Slider } from "#root/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#root/components/ui/select";
import { Upload, X, Loader2, Image as ImageIcon, Film } from "lucide-react";
import type { MediaSlot, MediaKind } from "#root/shared/types/homepage-content";
import { EMPTY_MEDIA_SLOT } from "#root/shared/types/homepage-content";

/**
 * The one control every CMS media slot uses.
 *
 * Gives the client, for a single slot: image-or-video, the desktop asset, an
 * optional dedicated mobile crop, a poster frame for video, alt text, and a
 * focal point for hard full-bleed crops.
 *
 * Uploads go through `homepage.uploadMedia` — the generic path — so images,
 * video and PDFs are all handled without touching the existing hero-image
 * endpoint that the legacy hero controls still depend on.
 */

type SubSlot = "desktopUrl" | "mobileUrl" | "posterUrl";

const ACCEPT_BY_KIND: Record<MediaKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/avif",
  video: "video/mp4,video/webm,video/quicktime",
};

export interface MediaSlotFieldProps {
  label: string;
  /** Shown under the label to explain what this slot is for. */
  hint?: string;
  value: MediaSlot | undefined;
  onChange: (next: MediaSlot) => void;
  /** Filename prefix so uploads stay identifiable on disk. */
  prefix?: string;
  /** Hide the video option for slots that only ever hold a still. */
  imageOnly?: boolean;
  disabled?: boolean;
}

export function MediaSlotField({
  label,
  hint,
  value,
  onChange,
  prefix = "media",
  imageOnly = false,
  disabled = false,
}: MediaSlotFieldProps) {
  const slot: MediaSlot = value ?? { ...EMPTY_MEDIA_SLOT };
  const [uploading, setUploading] = useState<SubSlot | null>(null);
  const inputs = {
    desktopUrl: useRef<HTMLInputElement>(null),
    mobileUrl: useRef<HTMLInputElement>(null),
    posterUrl: useRef<HTMLInputElement>(null),
  };

  const patch = (next: Partial<MediaSlot>) => onChange({ ...slot, ...next });

  const handleUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: SubSlot,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(target);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const result = await trpc.homepage.uploadMedia.mutate({
        file: { name: file.name, type: file.type, buffer },
        prefix,
      });

      if (result.success && result.data) {
        patch({ [target]: result.data.url } as Partial<MediaSlot>);
        toast.success("Uploaded");
      } else {
        toast.error(result.error || "Upload failed");
      }
    } catch (error) {
      console.error("Media upload error:", error);
      toast.error("Error uploading file");
    } finally {
      setUploading(null);
      event.target.value = "";
    }
  };

  const renderSubSlot = (
    target: SubSlot,
    subLabel: string,
    subHint: string,
    accept: string,
  ) => {
    const url = slot[target] ?? "";
    const isUploading = uploading === target;

    return (
      <div className='space-y-2'>
        <div className='flex items-baseline justify-between gap-2'>
          <Label className='text-xs font-medium'>{subLabel}</Label>
          <span className='text-[11px] text-muted-foreground'>{subHint}</span>
        </div>

        {url ? (
          <div className='relative overflow-hidden rounded-md border bg-muted'>
            {slot.kind === "video" && target !== "posterUrl" ? (
              <video
                src={url}
                className='h-28 w-full object-cover'
                muted
                playsInline
              />
            ) : (
              <img src={url} alt='' className='h-28 w-full object-cover' />
            )}
            <Button
              type='button'
              variant='destructive'
              size='icon'
              disabled={disabled}
              onClick={() => patch({ [target]: "" } as Partial<MediaSlot>)}
              className='absolute right-1.5 top-1.5 h-6 w-6'>
              <X className='h-3 w-3' />
            </Button>
          </div>
        ) : (
          <button
            type='button'
            disabled={disabled || isUploading}
            onClick={() => inputs[target].current?.click()}
            className='flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50'>
            {isUploading ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Upload className='h-4 w-4' />
            )}
            <span className='text-[11px]'>
              {isUploading ? "Uploading…" : "Upload"}
            </span>
          </button>
        )}

        <input
          ref={inputs[target]}
          type='file'
          accept={accept}
          className='hidden'
          onChange={(e) => handleUpload(e, target)}
        />

        <Input
          value={url}
          disabled={disabled}
          placeholder='…or paste a URL'
          onChange={(e) =>
            patch({ [target]: e.target.value } as Partial<MediaSlot>)
          }
          className='h-8 text-xs'
        />
      </div>
    );
  };

  const focal = slot.focalPoint ?? { x: 50, y: 50 };

  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <div>
        <Label className='text-sm font-semibold'>{label}</Label>
        {hint && (
          <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
        )}
      </div>

      {/* Image / video */}
      {!imageOnly && (
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant={slot.kind === "image" ? "primary" : "outline"}
            disabled={disabled}
            onClick={() => patch({ kind: "image" })}
            className='h-8 text-xs'>
            <ImageIcon className='mr-1.5 h-3 w-3' /> Image
          </Button>
          <Button
            type='button'
            size='sm'
            variant={slot.kind === "video" ? "primary" : "outline"}
            disabled={disabled}
            onClick={() => patch({ kind: "video" })}
            className='h-8 text-xs'>
            <Film className='mr-1.5 h-3 w-3' /> Video
          </Button>
        </div>
      )}

      <div className='grid gap-4 sm:grid-cols-2'>
        {renderSubSlot(
          "desktopUrl",
          "Desktop",
          "wide crop",
          ACCEPT_BY_KIND[slot.kind],
        )}
        {renderSubSlot(
          "mobileUrl",
          "Mobile",
          "optional — falls back to desktop",
          ACCEPT_BY_KIND[slot.kind],
        )}
      </div>

      {slot.kind === "video" && (
        <div className='grid gap-4 sm:grid-cols-2'>
          {renderSubSlot(
            "posterUrl",
            "Poster frame",
            "shown before playback",
            ACCEPT_BY_KIND.image,
          )}
        </div>
      )}

      <div className='space-y-2'>
        <Label className='text-xs font-medium'>Alt text</Label>
        <Input
          value={slot.alt ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ alt: e.target.value })}
          placeholder='Describes the image for screen readers and search'
          className='h-8 text-xs'
        />
      </div>

      {/* Focal point — lets a hard full-bleed crop be re-centred without
          re-cutting the asset. */}
      <div className='space-y-3'>
        <div className='flex items-baseline justify-between'>
          <Label className='text-xs font-medium'>Focal point</Label>
          <span className='text-[11px] text-muted-foreground'>
            {focal.x}% / {focal.y}%
          </span>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <span className='text-[11px] text-muted-foreground'>
              Horizontal
            </span>
            <Slider
              value={[focal.x]}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              onValueChange={([x]) =>
                patch({ focalPoint: { x: x ?? 50, y: focal.y } })
              }
            />
          </div>
          <div className='space-y-1.5'>
            <span className='text-[11px] text-muted-foreground'>Vertical</span>
            <Slider
              value={[focal.y]}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              onValueChange={([y]) =>
                patch({ focalPoint: { x: focal.x, y: y ?? 50 } })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Placement controls                                                */
/* ------------------------------------------------------------------ */

/**
 * Text placement + treatment for a block overlaid on media. Shared by the
 * hero and every campaign banner so the two behave identically.
 */
export function MediaTextControls({
  align,
  verticalAlign,
  textTheme,
  overlayOpacity,
  onChange,
  disabled = false,
}: {
  align: string;
  verticalAlign: string;
  textTheme: string;
  overlayOpacity: number;
  onChange: (next: {
    align?: string;
    verticalAlign?: string;
    textTheme?: string;
    overlayOpacity?: number;
  }) => void;
  disabled?: boolean;
}) {
  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <Label className='text-sm font-semibold'>Text placement</Label>

      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1.5'>
          <Label className='text-xs'>Horizontal</Label>
          <Select
            value={align}
            disabled={disabled}
            onValueChange={(v) => onChange({ align: v })}>
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='left'>Left</SelectItem>
              <SelectItem value='center'>Center</SelectItem>
              <SelectItem value='right'>Right</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-1.5'>
          <Label className='text-xs'>Vertical</Label>
          <Select
            value={verticalAlign}
            disabled={disabled}
            onValueChange={(v) => onChange({ verticalAlign: v })}>
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='top'>Top</SelectItem>
              <SelectItem value='middle'>Middle</SelectItem>
              <SelectItem value='bottom'>Bottom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-1.5'>
          <Label className='text-xs'>Text colour</Label>
          <Select
            value={textTheme}
            disabled={disabled}
            onValueChange={(v) => onChange({ textTheme: v })}>
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='light'>Light (on dark media)</SelectItem>
              <SelectItem value='dark'>Dark (on light media)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='space-y-2'>
        <div className='flex items-baseline justify-between'>
          <Label className='text-xs'>Overlay strength</Label>
          <span className='text-[11px] text-muted-foreground'>
            {overlayOpacity}%
          </span>
        </div>
        <Slider
          value={[overlayOpacity]}
          min={0}
          max={100}
          step={5}
          disabled={disabled}
          onValueChange={([v]) => onChange({ overlayOpacity: v ?? 0 })}
        />
        <p className='text-[11px] text-muted-foreground'>
          Darkens the media behind the text. Raise it if the headline is hard
          to read against a busy photo.
        </p>
      </div>
    </div>
  );
}
