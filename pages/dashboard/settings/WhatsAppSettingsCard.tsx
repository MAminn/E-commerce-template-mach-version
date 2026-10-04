"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Save } from "lucide-react";
import { trpc } from "#root/shared/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#root/components/ui/card";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import { Switch } from "#root/components/ui/switch";
import { Textarea } from "#root/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#root/components/ui/select";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WHATSAPP_MESSAGE_MAX_LENGTH,
  buildWhatsAppUrl,
  validateWhatsAppSettings,
  type WhatsAppSettings,
  type WhatsAppVisibility,
} from "#root/shared/whatsapp/config";

/**
 * Store-wide floating WhatsApp button. Its own settings — the footer contact
 * phone is a separate field and is not read here.
 */

const VISIBILITY_LABELS: Record<WhatsAppVisibility, string> = {
  both: "Mobile and desktop",
  mobile: "Mobile only",
  desktop: "Desktop only",
};

type FieldErrors = Partial<
  Record<"phoneNumber" | "message" | "visibility", string>
>;

export function WhatsAppSettingsCard() {
  const [settings, setSettings] = useState<WhatsAppSettings>(
    DEFAULT_WHATSAPP_SETTINGS,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // What the storefront shows right now — the last loaded/saved value, not
  // the unsaved toggle.
  const [savedEnabled, setSavedEnabled] = useState(
    DEFAULT_WHATSAPP_SETTINGS.enabled,
  );

  useEffect(() => {
    let cancelled = false;
    trpc.whatsapp.getSettings
      .query()
      .then((r) => {
        if (!cancelled && r.success) {
          setSettings(r.result);
          setSavedEnabled(r.result.enabled);
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load WhatsApp settings");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (p: Partial<WhatsAppSettings>) => {
    setSettings((s) => ({ ...s, ...p }));
    setErrors({});
  };

  const handleSave = async () => {
    // Same rules the server enforces, run first so mistakes show inline.
    const validation = validateWhatsAppSettings(settings);
    if (!validation.ok) {
      setErrors(validation.errors);
      toast.error("Fix the highlighted WhatsApp settings before saving");
      return;
    }
    setIsSaving(true);
    try {
      const r = await trpc.whatsapp.updateSettings.mutate(validation.settings);
      if (r.success) {
        setSettings(r.result);
        setSavedEnabled(r.result.enabled);
        toast.success("WhatsApp settings saved");
      } else {
        toast.error(r.error || "Failed to save WhatsApp settings");
      }
    } catch {
      toast.error("Failed to save WhatsApp settings");
    } finally {
      setIsSaving(false);
    }
  };

  const previewUrl = buildWhatsAppUrl(settings.phoneNumber, settings.message);

  return (
    <Card id='whatsapp'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <MessageCircle className='h-5 w-5' />
          WhatsApp
          {!isLoading && (
            <span
              data-testid='whatsapp-status-badge'
              className={
                savedEnabled
                  ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                  : "rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700"
              }>
              {savedEnabled ? "On" : "Off"}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          A floating chat button in the bottom-right corner of the storefront.
          Tapping it opens a WhatsApp chat with this number — nothing is sent
          automatically. Separate from the footer contact phone.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {isLoading ? (
          <div className='flex justify-center py-6'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : (
          <>
            <div className='flex items-center justify-between gap-4 rounded-md border p-3'>
              <div className='space-y-0.5'>
                <Label htmlFor='whatsappEnabled'>
                  Enable WhatsApp floating button
                </Label>
                <p className='text-xs text-muted-foreground'>
                  Requires a valid WhatsApp number.
                </p>
              </div>
              <Switch
                id='whatsappEnabled'
                checked={settings.enabled}
                onCheckedChange={(v) => patch({ enabled: v })}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='whatsappPhone'>WhatsApp number</Label>
              <Input
                id='whatsappPhone'
                type='tel'
                inputMode='tel'
                autoComplete='off'
                placeholder='201012345678'
                value={settings.phoneNumber}
                aria-invalid={errors.phoneNumber ? true : undefined}
                aria-describedby='whatsappPhoneHint'
                onChange={(e) => patch({ phoneNumber: e.target.value })}
              />
              {errors.phoneNumber ? (
                <p
                  id='whatsappPhoneHint'
                  data-testid='whatsapp-phone-error'
                  className='text-xs font-medium text-destructive'>
                  {errors.phoneNumber}
                </p>
              ) : (
                <p
                  id='whatsappPhoneHint'
                  className='text-xs text-muted-foreground'>
                  International format with the country code, e.g. +20 10 1234
                  5678 or 201012345678. Spaces, dashes and a leading + are
                  removed when saved.
                </p>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='whatsappMessage'>
                Prefilled message (optional)
              </Label>
              <Textarea
                id='whatsappMessage'
                rows={3}
                maxLength={WHATSAPP_MESSAGE_MAX_LENGTH}
                placeholder='Hi MACH, I have a question about...'
                value={settings.message}
                aria-invalid={errors.message ? true : undefined}
                onChange={(e) => patch({ message: e.target.value })}
              />
              {errors.message ? (
                <p className='text-xs font-medium text-destructive'>
                  {errors.message}
                </p>
              ) : (
                <p className='text-xs text-muted-foreground'>
                  Plain text the shopper sees in the chat box before sending (
                  {settings.message.length}/{WHATSAPP_MESSAGE_MAX_LENGTH}).
                </p>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='whatsappVisibility'>Show on</Label>
              <Select
                value={settings.visibility}
                onValueChange={(v) =>
                  patch({ visibility: v as WhatsAppVisibility })
                }>
                <SelectTrigger
                  id='whatsappVisibility'
                  className='w-full sm:w-64'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(VISIBILITY_LABELS) as WhatsAppVisibility[]
                  ).map((k) => (
                    <SelectItem key={k} value={k}>
                      {VISIBILITY_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                Mobile means screens narrower than 1024px.
              </p>
            </div>

            {previewUrl && (
              <p className='break-all text-xs text-muted-foreground'>
                Link:{" "}
                <code data-testid='whatsapp-link-preview'>{previewUrl}</code>
              </p>
            )}

            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Saving...
                </>
              ) : (
                <>
                  <Save className='mr-2 h-4 w-4' />
                  Save WhatsApp Settings
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
