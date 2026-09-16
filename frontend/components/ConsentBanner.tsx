import React, { useEffect, useState } from "react";
import { useConsent } from "#root/frontend/contexts/ConsentContext";
import { Button } from "#root/components/ui/button";
import { Switch } from "#root/components/ui/switch";
import { Shield, Settings, X, Cookie } from "lucide-react";
import type { ConsentCategories } from "#root/shared/types/pixel-tracking";

// ─── Consent Category Descriptions ──────────────────────────────────────────

const CATEGORY_INFO: {
  key: keyof ConsentCategories;
  label: string;
  description: string;
  disabled: boolean;
}[] = [
  {
    key: "functional",
    label: "Functional",
    description:
      "Essential tracking for core features like session management and shopping cart. Always enabled.",
    disabled: true,
  },
  {
    key: "analytics",
    label: "Analytics",
    description:
      "Page views, scroll depth, and engagement tracking to help us improve the shopping experience.",
    disabled: false,
  },
  {
    key: "marketing",
    label: "Marketing",
    description:
      "Advertising pixels and conversion tracking to show you relevant ads across platforms.",
    disabled: false,
  },
];

// ─── Banner Component ───────────────────────────────────────────────────────

export function ConsentBanner() {
  const {
    consent,
    showBanner,
    acceptAll,
    rejectAll,
    updateCategories,
    openPreferences,
    preferencesRequested,
  } = useConsent();
  const [showCustomize, setShowCustomize] = useState(false);
  const [customCategories, setCustomCategories] = useState<ConsentCategories>({
    functional: true,
    analytics: consent.categories.analytics,
    marketing: consent.categories.marketing,
  });

  // Keep the toggles in step with the stored decision, so re-opening
  // preferences shows what the visitor actually chose rather than the state
  // this component happened to mount with.
  useEffect(() => {
    setCustomCategories({
      functional: true,
      analytics: consent.categories.analytics,
      marketing: consent.categories.marketing,
    });
  }, [consent.categories.analytics, consent.categories.marketing]);

  // A visitor who re-opens preferences wants the toggles, not the intro copy.
  useEffect(() => {
    if (preferencesRequested) setShowCustomize(true);
  }, [preferencesRequested]);

  // Once a decision exists the banner is hidden, but withdrawing consent has
  // to stay reachable — otherwise "Accept" is irreversible.
  if (!showBanner) {
    return (
      <button
        type="button"
        onClick={openPreferences}
        aria-label="Cookie preferences"
        data-testid="consent-reopen"
        className="fixed bottom-3 left-3 z-40 flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
      >
        <Cookie className="h-3.5 w-3.5" />
        Cookie preferences
      </button>
    );
  }

  const handleSaveCustom = () => {
    updateCategories(customCategories);
    setShowCustomize(false);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background p-4 shadow-lg"
      role="dialog"
      aria-label="Cookie consent"
      data-testid="consent-banner"
    >
      <div className="mx-auto max-w-4xl">
        {!showCustomize ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  We value your privacy
                </p>
                <p className="text-sm text-muted-foreground">
                  We use cookies and similar technologies to enhance your
                  experience, analyze traffic, and serve personalized ads.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={rejectAll}
                data-testid="consent-reject"
              >
                Reject All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCustomize(true)}
                data-testid="consent-customize"
              >
                <Settings className="mr-1 h-3.5 w-3.5" />
                Customize
              </Button>
              <Button
                size="sm"
                onClick={acceptAll}
                data-testid="consent-accept"
              >
                Accept All
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Customize Cookie Preferences
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCustomize(false)}
                aria-label="Close customize"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              {CATEGORY_INFO.map((cat) => (
                <div
                  key={cat.key}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="mr-4">
                    <p className="text-sm font-medium">{cat.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {cat.description}
                    </p>
                  </div>
                  <Switch
                    checked={customCategories[cat.key]}
                    disabled={cat.disabled}
                    onCheckedChange={(checked) =>
                      setCustomCategories((prev) => ({
                        ...prev,
                        [cat.key]: checked,
                      }))
                    }
                    data-testid={`consent-toggle-${cat.key}`}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCustomize(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveCustom}
                data-testid="consent-save-custom"
              >
                Save Preferences
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
