/**
 * Shared <script> loader for vendor pixel SDKs.
 *
 * Two pixels of the same platform (two Meta pixel IDs, say) share one vendor
 * SDK file. Injecting it twice re-runs the vendor bootstrap and can re-fire
 * whatever the previous instance had queued, so the tag is injected at most
 * once per URL and every caller subscribes to the same outcome.
 *
 * Callers get told whether the script loaded or failed; they are never told
 * anything about whether the platform accepted an event.
 */

export type SdkLoadOutcome = "loaded" | "failed";

interface LoaderEntry {
  outcome: SdkLoadOutcome | null;
  element: HTMLScriptElement | null;
  listeners: Set<(outcome: SdkLoadOutcome) => void>;
}

const entries = new Map<string, LoaderEntry>();

/** Insert a script before the first existing one (vendor-snippet placement). */
function insertScript(script: HTMLScriptElement): void {
  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }
}

/**
 * Load `src` once. `onOutcome` fires exactly once per call — immediately if
 * the script already settled, otherwise when it loads or errors.
 *
 * `alreadyPresent` marks a script the page loaded by other means (GTM, a
 * hardcoded tag): the SDK is there, so we resolve as loaded without injecting.
 *
 * A previous failure is NOT sticky. An ad blocker that was toggled off, a
 * flaky network, or a CDN blip would otherwise leave the pixel dead for the
 * whole page: the memoized "failed" outcome would be handed to every later
 * caller and no new tag would ever be injected. A caller that asks again
 * after a failure gets a fresh injection attempt.
 */
export function loadSdkScript(
  src: string,
  onOutcome: (outcome: SdkLoadOutcome) => void,
  options?: { alreadyPresent?: boolean },
): void {
  if (typeof document === "undefined") {
    onOutcome("failed");
    return;
  }

  let entry = entries.get(src);

  // Discard a settled failure so this call retries rather than replaying it.
  if (entry?.outcome === "failed") {
    entries.delete(src);
    entry = undefined;
  }

  if (!entry) {
    entry = { outcome: null, element: null, listeners: new Set() };
    entries.set(src, entry);

    if (options?.alreadyPresent) {
      entry.outcome = "loaded";
    }
  }

  if (entry.outcome) {
    onOutcome(entry.outcome);
    return;
  }

  entry.listeners.add(onOutcome);

  // Injection already in flight — the pending listener set will be notified.
  if (entry.element) return;

  const settle = (outcome: SdkLoadOutcome) => {
    const current = entries.get(src);
    if (!current || current.outcome) return;
    current.outcome = outcome;
    const listeners = Array.from(current.listeners);
    current.listeners.clear();
    for (const listener of listeners) {
      try {
        listener(outcome);
      } catch {
        // A subscriber must never break the others.
      }
    }
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  script.addEventListener?.("load", () => settle("loaded"));
  script.addEventListener?.("error", () => settle("failed"));
  entry.element = script;

  try {
    insertScript(script);
  } catch {
    settle("failed");
  }
}

/** Whether `src` has already been injected (or marked present) this page. */
export function isSdkScriptRequested(src: string): boolean {
  return entries.has(src);
}

/**
 * Reset loader bookkeeping. Tests only — a real page never unloads a vendor
 * SDK, so adapters deliberately do not remove these scripts on destroy().
 */
export function __resetSdkLoaderForTests(): void {
  entries.clear();
}
