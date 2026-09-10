import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { MachSocialProofCard } from "./MachSocialProofCard";
import { trpc } from "#root/shared/trpc/client";
import { getProductUrl } from "#root/lib/utils/route-helpers";
import {
  formatRelativeTime,
  getSocialProofStorage,
  isSocialProofSuppressed,
  readShownCount,
  suppressSocialProof,
  writeShownCount,
} from "#root/lib/social-proof-session";
import {
  isProductDetailRoute,
  isSocialProofExcludedRoute,
} from "#root/lib/social-proof-routes";

/**
 * Mach recent-order toast.
 *
 * A small bottom-left card naming a real, already-placed order: who (first
 * name plus one initial), roughly where, what, and how long ago. Everything
 * it renders was sanitised on the server — this component receives no order
 * id, email, phone or address, and could not display one if it tried.
 *
 * This file owns *when* a card appears: the feed fetch, the route gate, the
 * per-session budget and the timers. How it looks — and the stretched-link /
 * close-button construction that keeps the X from navigating — belongs to
 * `MachSocialProofCard`, which the admin preview mounts with demo copy so the
 * two can never drift apart.
 */

interface SocialProofEvent {
  eventKey: string;
  displayName: string;
  location: string | null;
  productId: string;
  productSlug: string | null;
  productName: string;
  productImageUrl: string | null;
  occurredAt: Date | string;
}

interface SocialProofClientConfig {
  enabled: boolean;
  firstDelaySeconds: number;
  displayDurationSeconds: number;
  intervalSeconds: number;
  maxPerSession: number;
  showRelativeTime: boolean;
}

interface SocialProofFeed {
  config: SocialProofClientConfig;
  events: SocialProofEvent[];
}

/**
 * Clearance above the Mach product page's mobile purchase bar.
 *
 * That bar is `p-3` around a 48px control — the product page itself reserves
 * 76px of clearance for it — so 88px puts this card a comfortable 12px above
 * the Add to Bag button instead of resting on it. Only applies below `lg`,
 * which is where the bar exists at all.
 */
const PDP_BOTTOM_PX = 88;
const DEFAULT_BOTTOM_PX = 12;

/** Matches the CSS transition below, so the node unmounts after it finishes. */
const EXIT_MS = 300;
/** One frame's grace so the entering card transitions instead of snapping in. */
const ENTER_FRAME_MS = 24;

export function MachSocialProofToast() {
  const { urlPathname } = usePageContext();
  const excluded = isSocialProofExcludedRoute(urlPathname);
  const isPdp = isProductDetailRoute(urlPathname);

  const [feed, setFeed] = useState<SocialProofFeed | null>(null);
  const [active, setActive] = useState<SocialProofEvent | null>(null);
  const [shown, setShown] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const mountedRef = useRef(true);
  const fetchedRef = useRef(false);

  // Declared first so its cleanup runs before the scheduler's — that ordering
  // is what guarantees the scheduler's teardown can't setState after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Client-side fetch, once. Deliberately not SSR data: this is a decorative
  // overlay that must not touch first paint, and rendering nothing on the
  // server means there is no hydration mismatch to have.
  useEffect(() => {
    if (excluded || fetchedRef.current) return;
    fetchedRef.current = true;
    trpc.socialProof.getPublicFeed
      .query()
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.success) setFeed(result.result as SocialProofFeed);
      })
      .catch(() => {
        // A feed that fails to load simply never shows — never a console error
        // on a storefront page for a decorative widget.
      });
  }, [excluded]);

  const dismiss = useCallback(() => {
    suppressSocialProof(getSocialProofStorage());
    setDismissed(true);
    setShown(false);
    setActive(null);
  }, []);

  /**
   * The whole timing engine, in one effect so there is exactly one owner of
   * the timer set. Every `setTimeout` id lands in `timers` and every exit path
   * — unmount, route change, config change, dismissal — runs the same cleanup.
   */
  useEffect(() => {
    if (excluded || dismissed) return;
    if (!feed?.config.enabled) return;

    const { events, config } = feed;
    if (events.length === 0) return;

    const storage = getSocialProofStorage();
    if (isSocialProofSuppressed(storage)) return;

    // The session's whole allowance: never more than the cap, and never more
    // than the number of distinct real events available. Cycling the pool a
    // second time just to reach `maxPerSession` would mean showing the same
    // person's order twice, which is where social proof starts reading as
    // fabricated.
    const total = Math.min(config.maxPerSession, events.length);
    let cursor = readShownCount(storage);
    if (cursor >= total) return;

    const timers: number[] = [];
    const wait = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };

    const show = () => {
      if (!mountedRef.current) return;
      // Re-checked here rather than only up front: a dismissal could have
      // landed in this tab while the cycle was waiting.
      if (isSocialProofSuppressed(storage)) return;
      const event = events[cursor];
      if (!event) return;

      cursor += 1;
      writeShownCount(storage, cursor);
      setActive(event);
      wait(() => {
        if (mountedRef.current) setShown(true);
      }, ENTER_FRAME_MS);
      wait(hide, config.displayDurationSeconds * 1000);
    };

    function hide() {
      if (!mountedRef.current) return;
      setShown(false);
      wait(() => {
        if (!mountedRef.current) return;
        setActive(null);
        if (cursor < total) wait(show, config.intervalSeconds * 1000);
      }, EXIT_MS);
    }

    wait(show, config.firstDelaySeconds * 1000);

    return () => {
      for (const id of timers) window.clearTimeout(id);
      if (!mountedRef.current) return;
      setShown(false);
      setActive(null);
    };
  }, [feed, excluded, dismissed]);

  // Escape dismisses, matching the X. Bound only while a card is on screen so
  // the storefront carries no idle global key listener.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, dismiss]);

  const relativeTime = useMemo(() => {
    if (!active || !feed?.config.showRelativeTime) return "";
    return formatRelativeTime(active.occurredAt);
  }, [active, feed?.config.showRelativeTime]);

  if (excluded || dismissed || !active) return null;

  const href = getProductUrl({ id: active.productId, slug: active.productSlug });

  return (
    <div
      // `pointer-events-none` on the positioner so the empty column beside a
      // narrow card never eats clicks on the page behind it.
      className='pointer-events-none fixed left-3 right-3 z-[9998] flex justify-start sm:left-6 sm:right-auto lg:bottom-6'
      style={{
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${
          isPdp ? PDP_BOTTOM_PX : DEFAULT_BOTTOM_PX
        }px)`,
      }}
      role='status'
      aria-live='polite'>
      <MachSocialProofCard
        // Keyed on the event so each notification is a fresh node — the enter
        // transition can never inherit the previous card's transform.
        key={active.eventKey}
        displayName={active.displayName}
        location={active.location}
        productName={active.productName}
        productImageUrl={active.productImageUrl}
        relativeTime={relativeTime}
        href={href}
        onDismiss={dismiss}
        className={`pointer-events-auto transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
          shown
            ? "translate-x-0 translate-y-0 opacity-100"
            : "-translate-x-3 translate-y-2 opacity-0"
        }`}
      />
    </div>
  );
}
