import { useRef, useState } from "react";
import { toast } from "sonner";
import { uploadMediaFile } from "./uploadMediaFile";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Loader2, Upload, X } from "lucide-react";
import type { MediaKind } from "#root/shared/types/homepage-content";
import { ACCEPT_BY_KIND } from "./MediaSlotField";

/**
 * One asset, uploaded, previewed, replaced or removed.
 *
 * The compact form of `MediaSlotField`, for the settings that are a single
 * URL rather than a `MediaSlot`. It is not a second media system: uploads go
 * through the same `uploadMediaFile` — the one call to `homepage.uploadMedia`
 * in this CMS — land in the same uploads directory, and accept the same
 * formats, with `ACCEPT_BY_KIND` imported rather than restated so the two
 * controls cannot start disagreeing about what a client is allowed to
 * upload.
 *
 * What it leaves out is the point of it. `MediaSlotField` gives a hero or a
 * campaign banner a desktop crop, a mobile crop, a poster frame, alt text and
 * a focal point, because those assets *are* the section and every one of those
 * controls changes what the shopper sees. A section background is the surface
 * a shelf sits on; five more controls per shelf would make Homepage Admin
 * unusable for a setting whose only real question is "which file".
 */

export interface MediaUploadFieldProps {
  /** Which formats to accept, and how to preview what is already there. */
  kind: MediaKind;
  value: string | undefined;
  onChange: (next: string) => void;
  /** Filename prefix so uploads stay identifiable on disk. */
  prefix?: string;
  disabled?: boolean;
}

export function MediaUploadField({
  kind,
  value,
  onChange,
  prefix = "media",
  disabled = false,
}: MediaUploadFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const url = (value ?? "").trim();

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Exactly the path `MediaSlotField` uploads through — including the
      // prefix normalisation, which is the whole reason this control used to
      // fail where that one succeeded.
      const outcome = await uploadMediaFile(file, prefix);
      if (!outcome) return;

      if (outcome.ok) {
        onChange(outcome.url);
        toast.success("Uploaded");
      } else {
        toast.error(outcome.message);
      }
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className='space-y-2'>
      {url ? (
        <div className='relative overflow-hidden rounded-md border bg-muted'>
          {kind === "video" ? (
            // Muted and inline so the preview behaves like the storefront
            // layer it stands for; no autoplay, so the admin page does not
            // start playing back everything the client has ever uploaded.
            <video src={url} className='h-24 w-full object-cover' muted playsInline />
          ) : (
            <img src={url} alt='' className='h-24 w-full object-cover' />
          )}
          <div className='absolute right-1.5 top-1.5 flex items-center gap-1.5'>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              disabled={disabled || uploading}
              onClick={() => input.current?.click()}
              className='h-6 px-2 text-[11px]'>
              {uploading ? (
                <Loader2 className='h-3 w-3 animate-spin' />
              ) : (
                "Replace"
              )}
            </Button>
            <Button
              type='button'
              variant='destructive'
              size='icon'
              disabled={disabled}
              onClick={() => onChange("")}
              title='Remove'
              className='h-6 w-6'>
              <X className='h-3 w-3' />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type='button'
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
          className='flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50'>
          {uploading ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Upload className='h-4 w-4' />
          )}
          <span className='text-[11px]'>
            {uploading ? "Uploading…" : `Upload ${kind}`}
          </span>
        </button>
      )}

      <input
        ref={input}
        type='file'
        accept={ACCEPT_BY_KIND[kind]}
        className='hidden'
        onChange={handleUpload}
      />

      {/* The same fallback every other media control in this CMS offers, for
          an asset that already lives somewhere else. */}
      <Input
        value={url}
        disabled={disabled}
        placeholder='…or paste a URL'
        onChange={(e) => onChange(e.target.value)}
        className='h-8 text-xs'
      />
    </div>
  );
}
