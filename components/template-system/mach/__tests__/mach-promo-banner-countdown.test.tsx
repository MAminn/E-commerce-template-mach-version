// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomepagePromoBannerContent } from "#root/shared/types/homepage-content";
import { SALE_COUNTDOWN_ENDED_EVENT } from "#root/shared/sale-countdown/countdown";
import { MachPromoBannerBar } from "../MachPromoBanner";
import { useSaleCountdown } from "../useSaleCountdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Advance n seconds in 100ms slices, committing React between slices — a
 * browser commits right after each timer fires, whereas one big
 * advanceTimersByTime would run the whole span before React re-renders.
 */
async function seconds(n: number) {
  for (let i = 0; i < n * 10; i++) {
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
  }
}

const banner: HomepagePromoBannerContent = {
  enabled: true,
  text: "🔥 BLACK FRIDAY OFFER",
  linkText: "Shop Now",
  linkUrl: "/shop",
};

describe("MachPromoBannerBar with a countdown", () => {
  it("renders TEXT | SALE ENDS IN 00:59:59 | LINK, keeping the existing text and link", () => {
    const html = renderToStaticMarkup(
      <MachPromoBannerBar content={banner} countdown={{ label: "Sale ends in", remainingMs: 3_599_000 }} />,
    );
    const text = html.indexOf("🔥 BLACK FRIDAY OFFER");
    const clock = html.indexOf("Sale ends in <span class=\"tabular-nums\">00:59:59</span>");
    const link = html.indexOf(">Shop Now</a>");
    expect(text).toBeGreaterThan(-1);
    expect(clock).toBeGreaterThan(text);
    expect(link).toBeGreaterThan(clock);
    expect(html.match(/aria-hidden="true"[^>]*>\|</g)).toHaveLength(2);
    // The clock never breaks across lines on a phone; separators are desktop-only.
    expect(html).toContain('data-mach-sale-countdown="" role="timer" class="whitespace-nowrap"');
    expect(html).toContain('class="hidden text-white/40 sm:inline"');
  });

  it("is byte-for-byte the old banner when no countdown is running", () => {
    const withNone = renderToStaticMarkup(<MachPromoBannerBar content={banner} countdown={null} />);
    const legacy = renderToStaticMarkup(<MachPromoBannerBar content={banner} />);
    expect(withNone).toBe(legacy);
    expect(withNone).not.toContain("|");
    expect(withNone).not.toContain("data-mach-sale-countdown");
  });

  it("shows nothing at all when the banner itself is off", () => {
    const html = renderToStaticMarkup(
      <MachPromoBannerBar content={{ ...banner, enabled: false }} countdown={{ label: "Sale ends in", remainingMs: 5000 }} />,
    );
    expect(html).toBe("");
  });
});

describe("useSaleCountdown", () => {
  let container: HTMLDivElement;
  let latest: ReturnType<typeof useSaleCountdown> = null;
  function Probe() {
    latest = useSaleCountdown();
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-27T19:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    latest = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    container.remove();
  });

  it("counts down to the server deadline, corrected for a wrong device clock, and hides at zero", async () => {
    // The device clock is 10 minutes SLOW; the server says 19:10:00 now and
    // the sale ends at 19:11:00 — so 60s remain regardless of the device clock.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        active: true,
        endsAt: "2026-11-27T19:11:00.000Z",
        label: "Sale ends in",
        // The server's clock runs 10 minutes ahead of the device's.
        serverNow: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const ended = vi.fn();
    window.addEventListener(SALE_COUNTDOWN_ENDED_EVENT, ended);

    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/sale-countdown", expect.objectContaining({ cache: "no-store" }));
    expect(latest).not.toBeNull();
    expect(Math.round(latest!.remainingMs / 1000)).toBe(60);

    await seconds(30);
    // Each tick lands just after the second boundary (+15ms).
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(Math.round(latest!.remainingMs / 1000)).toBe(30);

    await seconds(31);
    expect(latest).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);

    window.removeEventListener(SALE_COUNTDOWN_ENDED_EVENT, ended);
    await act(async () => root.unmount());
  });

  it("renders nothing when the server says no countdown is running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ active: false, endsAt: null, label: "Sale ends in", serverNow: new Date().toISOString() }),
      })),
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest).toBeNull();
    await act(async () => root.unmount());
  });
});
