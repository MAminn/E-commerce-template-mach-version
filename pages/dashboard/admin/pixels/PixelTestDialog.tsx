import { useState } from "react";
import { trpc } from "#root/shared/trpc/client";
import { useTracking } from "#root/frontend/contexts/TrackingContext";
import { TrackingEventName } from "#root/shared/types/pixel-tracking";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#root/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "#root/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Monitor,
  Server,
  XCircle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TestablePixelConfig {
  id: string;
  platform: string;
  pixelId: string;
  enabled: boolean;
  enableClientSide: boolean;
  enableServerSide: boolean;
  consentRequired: boolean;
  accessToken: string | null;
}

interface ServerTestResult {
  platform: string;
  pixelIdMasked: string;
  eventName: string;
  eventId: string;
  testEventCode?: string;
  acceptedByApi: boolean;
  statusCode?: number;
  platformCode?: string;
  platformMessage?: string;
  requestId?: string;
  acceptedCount?: number;
  warnings?: string[];
  attempts?: number;
  error?: string;
  skippedReason?: string;
  productionWouldSkip?: string;
  verifyIn: string;
}

type TestMode = "browser" | "server";

/** Events a test may fire. Purchase is deliberately not offered. */
const TEST_EVENTS = [
  { value: TrackingEventName.PRODUCT_VIEWED, label: "Product viewed (ViewContent)" },
  { value: TrackingEventName.PAGE_VIEWED, label: "Page view" },
  { value: TrackingEventName.PRODUCT_ADDED_TO_CART, label: "Add to cart" },
  { value: TrackingEventName.CHECKOUT_STARTED, label: "Checkout started" },
] as const;

const TEST_CODE_LABEL: Record<string, string> = {
  meta: "Meta test event code (Events Manager → Test Events, e.g. TEST12345)",
  tiktok: "TikTok test_event_code (Events Manager → Test Event)",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function PixelTestDialog({
  config,
  open,
  onOpenChange,
}: {
  config: TestablePixelConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { dispatchToConfig } = useTracking();

  const [mode, setMode] = useState<TestMode>("browser");
  // ViewContent is a documented standard event on both Meta and TikTok and
  // is never policy-skipped, so it is the default for a meaningful test.
  const [eventName, setEventName] = useState<string>(
    TrackingEventName.PRODUCT_VIEWED,
  );
  const [testEventCode, setTestEventCode] = useState("");
  const [running, setRunning] = useState(false);
  const [browserResult, setBrowserResult] = useState<{
    dispatched: boolean;
    eventId: string;
  } | null>(null);
  const [serverResult, setServerResult] = useState<ServerTestResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!config) return null;

  const reset = () => {
    setBrowserResult(null);
    setServerResult(null);
    setErrorMessage(null);
  };

  const runBrowserTest = () => {
    reset();
    // Targets this configuration's adapter only, so a second pixel of the
    // same platform is not touched by the test.
    const result = dispatchToConfig(config.id, eventName);
    setBrowserResult(result);
  };

  const runServerTest = async () => {
    reset();
    setRunning(true);
    try {
      const response = await trpc.pixelTracking.test.server.mutate({
        configId: config.id,
        eventName: eventName as (typeof TEST_EVENTS)[number]["value"],
        ...(testEventCode.trim()
          ? { testEventCode: testEventCode.trim() }
          : {}),
        pageUrl: window.location.origin,
      });
      if (response.success) {
        setServerResult(response.result as ServerTestResult);
      } else {
        setErrorMessage(
          (response as { error?: { message?: string } }).error?.message ??
            "The server test could not be completed.",
        );
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "The server test failed.",
      );
    } finally {
      setRunning(false);
    }
  };

  const serverTestBlocked = !config.enableServerSide || !config.accessToken;
  const browserTestBlocked = !config.enabled || !config.enableClientSide;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>Test pixel</DialogTitle>
          <DialogDescription>
            Sends one event to this pixel configuration only. Final receipt is
            confirmed in the platform's own Test Events view — not here.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          {/* Target */}
          <div className='rounded-md border bg-muted/40 px-3 py-2 text-sm'>
            <span className='text-muted-foreground'>Target pixel: </span>
            <span className='font-mono break-all'>{config.pixelId}</span>
          </div>

          {/* Mode */}
          <div className='space-y-2'>
            <Label>What to test</Label>
            <div className='grid grid-cols-2 gap-2'>
              <Button
                type='button'
                variant={mode === "browser" ? "primary" : "outline"}
                onClick={() => {
                  setMode("browser");
                  reset();
                }}>
                <Monitor className='w-4 h-4 mr-2' />
                Browser pixel
              </Button>
              <Button
                type='button'
                variant={mode === "server" ? "primary" : "outline"}
                onClick={() => {
                  setMode("server");
                  reset();
                }}>
                <Server className='w-4 h-4 mr-2' />
                Server API
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              {mode === "browser"
                ? "Hands an event to the pixel SDK loaded in this browser tab. Reports whether the SDK accepted the call."
                : "Calls the platform's Conversions API from the server with the stored access token and reports exactly what it answered."}
            </p>
          </div>

          {/* Event */}
          <div className='space-y-2'>
            <Label htmlFor='test-event'>Event</Label>
            <Select value={eventName} onValueChange={setEventName}>
              <SelectTrigger id='test-event'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_EVENTS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              Purchase is not offered on purpose — a synthetic purchase would
              land in the same conversion metrics your campaigns optimize
              against and cannot be withdrawn.
            </p>
          </div>

          {/* Test event code (server only) */}
          {mode === "server" && (
            <div className='space-y-2'>
              <Label htmlFor='test-code'>
                {TEST_CODE_LABEL[config.platform] ??
                  "Platform test event code (optional)"}
              </Label>
              <Input
                id='test-code'
                value={testEventCode}
                placeholder='Optional — leave empty to send as normal traffic'
                onChange={(e) => setTestEventCode(e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>
                Used for this one request only. It is never saved on the pixel
                configuration and never attached to live traffic.
              </p>
            </div>
          )}

          {/* Blocked states */}
          {mode === "browser" && config.consentRequired && (
            <div className='flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2'>
              <AlertTriangle className='w-3.5 h-3.5 mt-0.5 shrink-0' />
              <span>
                This pixel requires consent, and the consent banner only runs
                on the storefront — not in the dashboard. A browser test here
                will report "not dispatched" until a consent decision exists in
                this browser. Test the browser pixel from a storefront page
                instead; the server test below is unaffected.
              </span>
            </div>
          )}
          {mode === "browser" && browserTestBlocked && (
            <div className='flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2'>
              <AlertTriangle className='w-3.5 h-3.5 mt-0.5 shrink-0' />
              <span>
                This pixel is disabled or has client-side tracking turned off,
                so no browser adapter is running for it.
              </span>
            </div>
          )}
          {mode === "server" && serverTestBlocked && (
            <div className='flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2'>
              <AlertTriangle className='w-3.5 h-3.5 mt-0.5 shrink-0' />
              <span>
                Server-side delivery needs to be enabled and an access token
                saved before the Conversions API can be tested.
              </span>
            </div>
          )}

          {/* Run */}
          <Button
            className='w-full'
            disabled={
              running ||
              (mode === "browser" ? browserTestBlocked : serverTestBlocked)
            }
            onClick={mode === "browser" ? runBrowserTest : runServerTest}>
            {running ? (
              <Loader2 className='w-4 h-4 mr-2 animate-spin' />
            ) : null}
            {mode === "browser" ? "Send browser event" : "Send server event"}
          </Button>

          {/* ── Results ───────────────────────────────────────────────── */}

          {errorMessage && (
            <div className='flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2'>
              <XCircle className='w-4 h-4 mt-0.5 shrink-0' />
              <span className='break-words'>{errorMessage}</span>
            </div>
          )}

          {browserResult && (
            <div className='space-y-2 rounded-md border px-3 py-2 text-sm'>
              <div className='flex items-center gap-2 font-medium'>
                {browserResult.dispatched ? (
                  <>
                    <CheckCircle2 className='w-4 h-4 text-emerald-600' />
                    Dispatched to the pixel SDK
                  </>
                ) : (
                  <>
                    <XCircle className='w-4 h-4 text-red-600' />
                    Not dispatched
                  </>
                )}
              </div>
              {browserResult.dispatched ? (
                <p className='text-xs text-muted-foreground'>
                  The SDK accepted the call in this tab. That is not proof the
                  platform received it — confirm in Test Events using the event
                  ID below. An ad blocker can still drop the network request.
                </p>
              ) : (
                <p className='text-xs text-muted-foreground'>
                  No adapter is running for this configuration in this tab. The
                  pixel may be disabled, blocked by consent, or its SDK script
                  may have failed to load. Reload the storefront and try again.
                </p>
              )}
              <div className='text-xs font-mono break-all'>
                Event ID: {browserResult.eventId}
              </div>
            </div>
          )}

          {serverResult && (
            <div className='space-y-2 rounded-md border px-3 py-2 text-sm'>
              <div className='flex items-center gap-2 font-medium'>
                {serverResult.acceptedByApi ? (
                  <>
                    <CheckCircle2 className='w-4 h-4 text-emerald-600' />
                    Accepted by the platform API
                  </>
                ) : (
                  <>
                    <XCircle className='w-4 h-4 text-red-600' />
                    Rejected by the platform API
                  </>
                )}
              </div>

              <p className='text-xs text-muted-foreground'>
                {serverResult.acceptedByApi
                  ? "The API accepted the request. Acceptance is not the same as being visible in reporting — platforms can still drop events for stale timestamps or identifier problems."
                  : "The API did not accept the request. Fix the error below and run the test again."}
              </p>

              <dl className='grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs'>
                <dt className='text-muted-foreground'>Pixel</dt>
                <dd className='font-mono break-all'>
                  {serverResult.pixelIdMasked}
                </dd>
                <dt className='text-muted-foreground'>Event ID</dt>
                <dd className='font-mono break-all'>{serverResult.eventId}</dd>
                {serverResult.statusCode !== undefined && (
                  <>
                    <dt className='text-muted-foreground'>HTTP status</dt>
                    <dd>{serverResult.statusCode}</dd>
                  </>
                )}
                {serverResult.platformCode && (
                  <>
                    <dt className='text-muted-foreground'>Platform code</dt>
                    <dd className='font-mono'>{serverResult.platformCode}</dd>
                  </>
                )}
                {serverResult.acceptedCount !== undefined && (
                  <>
                    <dt className='text-muted-foreground'>Events received</dt>
                    <dd>{serverResult.acceptedCount}</dd>
                  </>
                )}
                {serverResult.requestId && (
                  <>
                    <dt className='text-muted-foreground'>Request ID</dt>
                    <dd className='font-mono break-all'>
                      {serverResult.requestId}
                    </dd>
                  </>
                )}
                {serverResult.testEventCode && (
                  <>
                    <dt className='text-muted-foreground'>Test code</dt>
                    <dd className='font-mono'>{serverResult.testEventCode}</dd>
                  </>
                )}
              </dl>

              {serverResult.error && (
                <div className='text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 break-words'>
                  {serverResult.error}
                </div>
              )}
              {serverResult.skippedReason && (
                <div className='text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 break-words'>
                  {serverResult.skippedReason}
                </div>
              )}
              {serverResult.productionWouldSkip && (
                <div className='text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 break-words'>
                  {serverResult.productionWouldSkip}
                </div>
              )}
              {serverResult.warnings?.map((warning) => (
                <div
                  key={warning}
                  className='text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 break-words'>
                  {warning}
                </div>
              ))}

              <div className='flex items-start gap-2 text-xs text-muted-foreground'>
                <Info className='w-3.5 h-3.5 mt-0.5 shrink-0' />
                <span>Verify in: {serverResult.verifyIn}</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
