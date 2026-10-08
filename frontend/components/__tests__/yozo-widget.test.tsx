// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true}}
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsentState } from "#root/shared/types/pixel-tracking";
import {
  CONSENT_COOKIE_NAME,
  buildAcceptAllConsent,
  buildRejectAllConsent,
  isConfigAllowedByConsent,
  serializeConsentCookie,
} from "#root/shared/utils/consent-gate";

/**
 * The Yozo AI widget loader: every visitor on public storefront routes,
 * regardless of cookie consent; one tag per document; a full reload whenever
 * a document that ran Yozo reaches the dashboard; and no credential anywhere
 * a browser can read it.
 *
 * Consent scenarios run through the real ConsentProvider and consent cookie,
 * so they prove Yozo ignores consent *and* that the consent state the other
 * integrations rely on still behaves as before.
 *
 * Script file loading is disabled for this file (docblock above), so happy-dom
 * never fetches the provider and instead fires the tag's `error` event — the
 * same thing a browser does when Yozo is down or blocked.
 */

const page = { urlPathname: "/" };

vi.mock("vike-react/usePageContext", () => ({ usePageContext: () => page }));

const { YozoWidget } = await import("../YozoWidget");
const { ConsentProvider, useConsent } = await import("#root/frontend/contexts/ConsentContext");
const { Link } = await import("#root/components/utils/Link");
const {
  YOZO_WIDGET_SRC,
  YOZO_LOADER_ATTRIBUTE,
  injectYozoLoader,
  isYozoEligiblePath,
} = await import("#root/frontend/yozo/yozo-widget");
const { adminEntryRel, isAdminPath } = await import("#root/lib/admin-navigation");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVIDER_SRC = "https://agents.yozo.ai/widgets/yozo-widgets.js?v=1791373399744";

const yozoTags = () =>
  Array.from(document.querySelectorAll<HTMLScriptElement>("script")).filter((s) =>
    s.src.includes("yozo"),
  );

let container: HTMLDivElement;
let root: Root;
let reload: ReturnType<typeof vi.fn>;

/** The live consent context, captured from inside the real provider. */
let consentApi: ReturnType<typeof useConsent> | undefined;
function ConsentProbe() {
  consentApi = useConsent();
  return null;
}
function consent(): ReturnType<typeof useConsent> {
  if (!consentApi) throw new Error("ConsentProvider not rendered");
  return consentApi;
}

/** A returning visitor whose decision is already in the consent cookie. */
function persistConsent(state: ConsentState) {
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(serializeConsentCookie(state))};path=/`;
}

function clearConsentCookie() {
  document.cookie = `${CONSENT_COOKIE_NAME}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

const ANALYTICS_ONLY: ConsentState = {
  ...buildRejectAllConsent("settings_page"),
  categories: { functional: true, analytics: true, marketing: false },
};

/** How the site's marketing / analytics pixels are gated (unchanged). */
const marketingPixelAllowed = () =>
  isConfigAllowedByConsent({ consentRequired: true, consentCategory: "marketing" }, consent().consent);
const analyticsPixelAllowed = () =>
  isConfigAllowedByConsent({ consentRequired: true, consentCategory: "analytics" }, consent().consent);

/** The widget as the layout mounts it: inside the real ConsentProvider. */
function render(ui: React.ReactNode = <YozoWidget />) {
  act(() =>
    root.render(
      <ConsentProvider>
        <ConsentProbe />
        {ui}
      </ConsentProvider>,
    ),
  );
}

function expectOneProviderScript() {
  const tags = yozoTags();
  expect(tags).toHaveLength(1);
  const [tag] = tags;
  if (!tag) throw new Error("Yozo script missing");
  expect(tag.getAttribute("src")).toBe(PROVIDER_SRC);
  expect(tag.async).toBe(true);
  expect(tag.hasAttribute(YOZO_LOADER_ATTRIBUTE)).toBe(true);
  expect(tag.parentElement).toBe(document.head);
}

beforeEach(() => {
  page.urlPathname = "/";
  consentApi = undefined;
  clearConsentCookie();
  for (const s of document.querySelectorAll("script")) s.remove();
  reload = vi.fn();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
  // happy-dom reports every (deliberately) failed script load; let anything
  // else through so a real error still shows.
  const consoleError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("JavaScript file loading is disabled")) return;
    consoleError(...args);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearConsentCookie();
  vi.restoreAllMocks();
});

describe("provider script", () => {
  it("is the exact Yozo-supplied URL", () => {
    expect(YOZO_WIDGET_SRC).toBe(PROVIDER_SRC);
  });
});

describe("available to every visitor, whatever their consent", () => {
  it("1: no consent decision yet → loads (banner still offered)", () => {
    render();
    expect(consent().showBanner).toBe(true);
    expect(consent().consent.categories.marketing).toBe(false);
    expectOneProviderScript();
  });

  it("2: marketing rejected (persisted) → loads", () => {
    persistConsent(buildRejectAllConsent("banner_reject"));
    render();
    expect(consent().showBanner).toBe(false);
    expect(consent().consent.categories.marketing).toBe(false);
    expectOneProviderScript();
  });

  it("3: analytics-only (persisted) → loads", () => {
    persistConsent(ANALYTICS_ONLY);
    render();
    expect(consent().consent.categories).toMatchObject({ analytics: true, marketing: false });
    expectOneProviderScript();
  });

  it("4: marketing accepted (persisted) → loads", () => {
    persistConsent(buildAcceptAllConsent("banner_accept"));
    render();
    expect(consent().consent.categories.marketing).toBe(true);
    expectOneProviderScript();
  });

  it("dismissing the banner (implied, functional-only) → still loaded", () => {
    render();
    act(() => consent().dismissBanner());
    expectOneProviderScript();
  });

  it("5: accept → reject → analytics-only → accept in one session: one script, never reloaded", () => {
    render();
    expectOneProviderScript();

    act(() => consent().acceptAll());
    expectOneProviderScript();

    act(() => consent().rejectAll());
    expectOneProviderScript();

    act(() => consent().updateCategories({ functional: true, analytics: true, marketing: false }));
    expectOneProviderScript();

    act(() => consent().acceptAll());
    expectOneProviderScript();

    expect(reload).not.toHaveBeenCalled();
  });

  it("the widget does not read consent at all", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    for (const rel of ["frontend/components/YozoWidget.tsx", "frontend/yozo/yozo-widget.ts"]) {
      const src = readFileSync(path.join(ROOT, rel), "utf-8");
      expect(src, rel).not.toMatch(/ConsentContext|consent-gate|readConsentCookie|useConsent/);
    }
  });
});

describe("10: cookie consent for the other integrations is unchanged", () => {
  it("no decision: banner shown, marketing + analytics pixels blocked", () => {
    render();
    expect(consent().showBanner).toBe(true);
    expect(marketingPixelAllowed()).toBe(false);
    expect(analyticsPixelAllowed()).toBe(false);
  });

  it("reject: persisted to the cookie, banner hidden, both pixel categories blocked", () => {
    render();
    act(() => consent().rejectAll());
    expect(consent().showBanner).toBe(false);
    expect(document.cookie).toContain(`${CONSENT_COOKIE_NAME}=`);
    expect(marketingPixelAllowed()).toBe(false);
    expect(analyticsPixelAllowed()).toBe(false);
  });

  it("analytics-only: analytics pixels allowed, marketing pixels still blocked", () => {
    render();
    act(() => consent().updateCategories({ functional: true, analytics: true, marketing: false }));
    expect(analyticsPixelAllowed()).toBe(true);
    expect(marketingPixelAllowed()).toBe(false);
  });

  it("accept: both pixel categories allowed, and a refresh restores it from the cookie", () => {
    render();
    act(() => consent().acceptAll());
    expect(marketingPixelAllowed()).toBe(true);
    expect(analyticsPixelAllowed()).toBe(true);

    // Fresh provider reading the same cookie.
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(consent().showBanner).toBe(false);
    expect(marketingPixelAllowed()).toBe(true);
  });

  it("consent changes still notify the tracking runtime", () => {
    const seen: unknown[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("tracking:consent-changed", onChange);
    render();
    act(() => consent().rejectAll());
    window.removeEventListener("tracking:consent-changed", onChange);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ categories: { marketing: false } });
  });
});

describe("5: one load per document", () => {
  it("re-renders and client navigation keep exactly one script", () => {
    for (const pathname of ["/", "/shop", "/products/whey", "/cart", "/checkout", "/"]) {
      page.urlPathname = pathname;
      render();
      render();
    }
    expectOneProviderScript();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a remounted widget does not add a second tag", () => {
    render();
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expectOneProviderScript();
  });
});

describe("route exclusions", () => {
  it.each(["/dashboard", "/dashboard/orders", "/dashboard/payment-attempts"])(
    "6: never loads on %s, even with marketing consent",
    (pathname) => {
      persistConsent(buildAcceptAllConsent("banner_accept"));
      page.urlPathname = pathname;
      render();
      expect(yozoTags()).toHaveLength(0);
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it("7: never loads on the template preview, even with marketing consent", () => {
    persistConsent(buildAcceptAllConsent("banner_accept"));
    page.urlPathname = "/template-preview";
    render();
    expect(yozoTags()).toHaveLength(0);
  });

  it("storefront routes are eligible, lookalike paths are not mistaken for admin", () => {
    expect(isYozoEligiblePath("/")).toBe(true);
    expect(isYozoEligiblePath("/shop")).toBe(true);
    expect(isYozoEligiblePath("/links")).toBe(true);
    expect(isYozoEligiblePath("/dashboard-tips")).toBe(true);
    expect(isYozoEligiblePath("/dashboard")).toBe(false);
    expect(isYozoEligiblePath("/template-preview")).toBe(false);
  });
});

describe("storefront → dashboard is a full document navigation", () => {
  const linkRel = (href: string) =>
    container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)?.getAttribute("rel") ?? null;

  it("storefront links into the dashboard opt out of client routing", () => {
    page.urlPathname = "/";
    render(
      <>
        <Link href='/dashboard'>Dashboard</Link>
        <Link href='/dashboard/orders'>Orders</Link>
        <Link href='/shop'>Shop</Link>
      </>,
    );
    expect(linkRel("/dashboard")).toBe("external");
    expect(linkRel("/dashboard/orders")).toBe("external");
    expect(linkRel("/shop")).toBeNull();
  });

  it("navigation inside the dashboard stays client-routed", () => {
    page.urlPathname = "/dashboard";
    render(<Link href='/dashboard/orders'>Orders</Link>);
    expect(linkRel("/dashboard/orders")).toBeNull();
  });

  it("rel helper ignores query/hash and lookalike paths", () => {
    expect(isAdminPath("/dashboard?tab=1")).toBe(true);
    expect(isAdminPath("/dashboard#x")).toBe(true);
    expect(isAdminPath("/dashboardx")).toBe(false);
    expect(adminEntryRel("/dashboard", "/checkout")).toBe("external");
    expect(adminEntryRel("/dashboard/products", "/dashboard")).toBeUndefined();
    expect(adminEntryRel("/", "/dashboard")).toBeUndefined();
  });

  it("a client-routed arrival in the dashboard (back button, guard redirect) reloads a document that ran Yozo", () => {
    render();
    expectOneProviderScript();

    page.urlPathname = "/dashboard";
    render();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(yozoTags()).toHaveLength(0);
  });

  it("a client-routed arrival in the template preview reloads a document that ran Yozo", () => {
    render();
    expectOneProviderScript();

    page.urlPathname = "/template-preview";
    render();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(yozoTags()).toHaveLength(0);
  });

  it("a dashboard-first document is never reloaded", () => {
    page.urlPathname = "/dashboard";
    render();
    page.urlPathname = "/dashboard/orders";
    render();
    expect(reload).not.toHaveBeenCalled();
  });

  it("every storefront link into /dashboard goes through the shared Link", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const files = [
      "components/globals/Navbar.tsx",
      "components/template-system/editorial/EditorialNavbar.tsx",
      "components/template-system/mach/MachNavbar.tsx",
      "components/template-system/minimal/MinimalNavbar.tsx",
      "frontend/components/template/templates/checkout/DefaultCheckoutTemplate.tsx",
      "frontend/components/template/templates/checkout/ModernCheckoutTemplate.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(ROOT, rel), "utf-8");
      expect(src, rel).toContain('from "#root/components/utils/Link"');
      // A raw <a href="/dashboard"> would bypass adminEntryRel.
      expect(src, rel).not.toMatch(/<a\s[^>]*href=['"]\/dashboard/);
    }
  });
});

describe("8: provider failure never affects the storefront", () => {
  it("a failed script load leaves the page rendered and throws nothing", async () => {
    const onError = vi.fn();
    window.addEventListener("error", onError);
    render(
      <>
        <YozoWidget />
        <button type='button'>Add to cart</button>
      </>,
    );
    const [tag] = yozoTags();
    if (!tag) throw new Error("Yozo script missing");

    // File loading is disabled → happy-dom fails the load asynchronously.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    act(() => {
      tag.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("button")?.textContent).toBe("Add to cart");
    expect(yozoTags()).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
    window.removeEventListener("error", onError);
  });

  it("injection failing outright is swallowed", () => {
    const brokenDoc = {
      querySelector: () => null,
      createElement: () => {
        throw new Error("blocked");
      },
      head: document.head,
    } as unknown as Document;
    expect(() => injectYozoLoader(brokenDoc)).not.toThrow();
  });
});

describe("9: no Yozo credential is reachable from the browser", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  // Everything Vite can bundle for the client, plus the SSR head/layout.
  const CLIENT_DIRS = ["frontend", "components", "pages", "layouts", "lib", "hooks", "context", "shared"];

  function* sourceFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) yield* sourceFiles(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield full;
    }
  }

  it("no client-reachable module reads a YOZO_* env variable", () => {
    const offenders: string[] = [];
    for (const dir of CLIENT_DIRS) {
      const abs = path.join(ROOT, dir);
      try {
        statSync(abs);
      } catch {
        continue;
      }
      for (const file of sourceFiles(abs)) {
        // Any env read — process.env.X, import.meta.env.X, env["X"] — not
        // comments that merely name the variables.
        if (/env(?:\.|\[\s*["'`])YOZO_/.test(readFileSync(file, "utf-8"))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the widget module carries no shop id or secret, only the provider URL", () => {
    const src = readFileSync(path.join(ROOT, "frontend/yozo/yozo-widget.ts"), "utf-8");
    expect(src).not.toContain("1988");
    expect(src).not.toMatch(/import\.meta\.env|process\.env/);
  });

  it("Vite exposes no YOZO_* variable to the client", () => {
    const vite = readFileSync(path.join(ROOT, "vite.config.ts"), "utf-8");
    expect(vite).not.toMatch(/YOZO/);
    expect(vite).not.toMatch(/envPrefix/);
  });
});
