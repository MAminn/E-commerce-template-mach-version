import { useEffect, useRef, useState } from "react";
import {
  SALE_COUNTDOWN_ENDED_EVENT,
  clockOffsetMs,
  msUntilNextTick,
  type PublicSaleCountdown,
} from "#root/shared/sale-countdown/countdown";

/** Re-read the server state this often while the page is open (admin stop /
 * extend / start reaches open pages within this time). */
const RESYNC_MS = 60_000;
/** After reaching zero, confirm with the server this long later. */
const CONFIRM_AFTER_END_MS = 2_000;

export interface SaleCountdownView {
  label: string;
  remainingMs: number;
}

/**
 * The store-wide sale countdown, or null when none is running.
 *
 * The deadline always comes from the server (GET /api/sale-countdown,
 * no-store), so a refresh or another device shows the same time; the browser
 * only counts down to it, corrected for its own clock being off. Nothing is
 * rendered during SSR or before the first answer — no flash of a wrong time.
 * At zero it hides at once, tells the page (SALE_COUNTDOWN_ENDED_EVENT, which
 * the cart uses to re-read prices) and re-checks the server.
 */
export function useSaleCountdown(): SaleCountdownView | null {
  const [state, setState] = useState<{ endsAtMs: number; label: string; offsetMs: number } | null>(null);
  const [now, setNow] = useState(0);
  const endedFor = useRef<number | null>(null);
  const fetchRef = useRef<() => void>(() => {});

  // Server sync.
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const sync = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const started = Date.now();
        const res = await fetch("/api/sale-countdown", {
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const ended = Date.now();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as PublicSaleCountdown;
        if (cancelled) return;
        const endsAtMs = body.active && body.endsAt ? Date.parse(body.endsAt) : Number.NaN;
        if (!Number.isFinite(endsAtMs)) {
          setState(null);
          return;
        }
        const offsetMs = clockOffsetMs(started, ended, body.serverNow);
        setState({ endsAtMs, label: body.label, offsetMs });
        setNow(Date.now() + offsetMs);
      } catch (error) {
        // Unreachable server: keep counting to the deadline already known
        // (it only ever hides early, never shows a deadline it wasn't told).
        if ((error as { name?: string })?.name !== "AbortError") {
          console.warn("[SaleCountdown] sync failed", error);
        }
      }
    };

    fetchRef.current = () => void sync();
    void sync();
    const interval = window.setInterval(() => void sync(), RESYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // One timeout per displayed second, recomputed from the clock each time, so
  // it never drifts and a backgrounded tab is right the moment it wakes.
  // `now` is a dependency on purpose: each tick re-arms the next timeout.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` re-arms the per-second timeout
  useEffect(() => {
    if (!state) return;
    const remaining = state.endsAtMs - (Date.now() + state.offsetMs);
    if (remaining <= 0) {
      if (endedFor.current !== state.endsAtMs) {
        endedFor.current = state.endsAtMs;
        window.dispatchEvent(new CustomEvent(SALE_COUNTDOWN_ENDED_EVENT));
        const confirm = window.setTimeout(() => fetchRef.current(), CONFIRM_AFTER_END_MS);
        return () => window.clearTimeout(confirm);
      }
      return;
    }
    const id = window.setTimeout(() => setNow(Date.now() + state.offsetMs), msUntilNextTick(remaining) + 15);
    return () => window.clearTimeout(id);
  }, [state, now]);

  if (!state) return null;
  const remainingMs = state.endsAtMs - now;
  if (remainingMs <= 0) return null;
  return { label: state.label, remainingMs };
}
