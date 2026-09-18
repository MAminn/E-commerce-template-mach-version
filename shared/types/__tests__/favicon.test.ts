import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { faviconExtension, resolveFavicon } from "../favicon";
import { DEFAULT_LAYOUT_SETTINGS } from "../layout-settings";

/**
 * The CMS favicon.
 *
 * Dashboard → Layout Settings → Site Identity uploads a favicon, stores it on
 * `faviconUrl` in template-scoped layout settings, and `pages/+Head.tsx` renders
 * it. The chain persisted correctly; what it emitted did not. The Favicon
 * control accepts a PNG, the uploader ran every raster image through sharp and
 * wrote a `.webp`, and the head's extension ladder had no `.webp` rung — so it
 * fell through to its default and declared `type="image/png"` for a file the
 * server serves as `Content-Type: image/webp`.
 *
 * These tests pin the truthful version: the type always describes the file
 * that is actually served, favicons are stored as the format the control
 * advertises, and there is exactly one icon declaration in the document.
 */

const ROOT = path.resolve(__dirname, "../..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

const DEFAULT_HREF = "/assets/favicon.abc123.svg";

/* ================================================================== */
/*  Extension parsing                                                 */
/* ================================================================== */

describe("faviconExtension", () => {
  it("reads the extension from a path", () => {
    expect(faviconExtension("/uploads/layout/favicon-01a.png")).toBe("png");
    expect(faviconExtension("/uploads/layout/favicon-01a.SVG")).toBe("svg");
  });

  it("ignores a query string or fragment", () => {
    // `endsWith(".png")` said a cache-busted PNG was not a PNG.
    expect(faviconExtension("/uploads/a.png?v=2")).toBe("png");
    expect(faviconExtension("/uploads/a.ico#x")).toBe("ico");
  });

  it("is null when there is no extension to read", () => {
    expect(faviconExtension("/uploads/favicon")).toBeNull();
    expect(faviconExtension("/uploads/favicon.")).toBeNull();
    expect(faviconExtension("")).toBeNull();
  });
});

/* ================================================================== */
/*  Resolution                                                        */
/* ================================================================== */

describe("resolveFavicon", () => {
  it("uses the CMS favicon when one is set", () => {
    expect(
      resolveFavicon("/uploads/layout/favicon-01a.png", DEFAULT_HREF),
    ).toEqual({
      href: "/uploads/layout/favicon-01a.png",
      type: "image/png",
      isDefault: false,
    });
  });

  it("falls back to the bundled default when no CMS favicon exists", () => {
    // DEFAULT_LAYOUT_SETTINGS ships faviconUrl as "", which is the state of
    // this store's live layout-settings row.
    expect(DEFAULT_LAYOUT_SETTINGS.faviconUrl).toBe("");
    for (const empty of ["", "   ", undefined, null]) {
      const resolved = resolveFavicon(empty, DEFAULT_HREF);
      expect(resolved.href).toBe(DEFAULT_HREF);
      expect(resolved.isDefault).toBe(true);
      expect(resolved.type).toBe("image/svg+xml");
    }
  });

  it("declares the MIME type of the file that is actually served", () => {
    const cases: [string, string][] = [
      ["/uploads/layout/favicon-1.png", "image/png"],
      ["/uploads/layout/favicon-1.svg", "image/svg+xml"],
      ["/uploads/layout/favicon-1.ico", "image/x-icon"],
      ["/uploads/layout/favicon-1.webp", "image/webp"],
      ["/uploads/layout/favicon-1.jpg", "image/jpeg"],
      ["/uploads/layout/favicon-1.jpeg", "image/jpeg"],
      ["/uploads/layout/favicon-1.avif", "image/avif"],
    ];
    for (const [url, expected] of cases) {
      expect(resolveFavicon(url, DEFAULT_HREF).type).toBe(expected);
    }
  });

  it("never declares image/png for a file that is not a PNG", () => {
    // The specific lie the old head shipped: any unrecognised extension, and
    // .webp in particular, was announced as image/png.
    expect(resolveFavicon("/uploads/layout/favicon-1.webp", DEFAULT_HREF).type)
      .not.toBe("image/png");
  });

  it("reads the type out of a data: URI", () => {
    // Vite inlines assets/favicon.svg — it is under the asset size limit — so
    // the bundled default arrives as a data: URI with no extension to read.
    // Verified against a real SSR render of /about-us.
    const inlined = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0i";
    expect(resolveFavicon("", inlined)).toEqual({
      href: inlined,
      type: "image/svg+xml",
      isDefault: true,
    });
  });

  it("omits the type rather than guessing one", () => {
    // An extensionless or unknown URL gets no `type`, so the browser sniffs
    // the bytes instead of being told something false.
    expect(resolveFavicon("/uploads/layout/favicon-1", DEFAULT_HREF).type)
      .toBeUndefined();
    expect(resolveFavicon("/uploads/layout/favicon-1.bmp", DEFAULT_HREF).type)
      .toBeUndefined();
  });

  it("matches the Content-Type the upload route serves for each extension", () => {
    // server.ts maps extension → Content-Type for /uploads/*. The head must
    // agree with it or the declaration is a lie on every request.
    const server = read("server/server.ts");
    const mapBlock = server.slice(
      server.indexOf("const mimeTypes: Record<string, string> = {"),
    );
    for (const [extension, type] of [
      ["png", "image/png"],
      ["svg", "image/svg+xml"],
      ["ico", "image/x-icon"],
      ["webp", "image/webp"],
    ]) {
      expect(mapBlock).toContain(`${extension}: "${type}"`);
      expect(resolveFavicon(`/uploads/layout/f.${extension}`, DEFAULT_HREF).type)
        .toBe(type);
    }
  });
});

/* ================================================================== */
/*  Cache behaviour                                                   */
/* ================================================================== */

describe("favicon URLs change when the favicon changes", () => {
  it("gives every upload a unique filename, so no cache busting is needed", () => {
    // uuid v7 per upload means a new favicon is always a new URL — browsers
    // cannot serve the previous icon for it. Equally, the URL is stable
    // between uploads, so nothing re-downloads on every render.
    const uploader = read("backend/layout/upload-layout-image/index.ts");
    expect(uploader).toContain("const fileId = v7();");
    expect(uploader).toContain("`${prefix}-${fileId}.png`");
    expect(uploader).toContain("`${prefix}-${fileId}.svg`");
    expect(uploader).toContain("`${prefix}-${fileId}.ico`");
  });

  it("renders no per-request cache-busting query", () => {
    // A value that changes every render would re-download the icon forever
    // and defeat caching entirely.
    const head = read("pages/+Head.tsx");
    expect(head).not.toContain("Date.now()");
    expect(head).not.toContain("Math.random()");
  });

  it("resolves a cache-busted URL to the right type anyway", () => {
    expect(resolveFavicon("/uploads/layout/f.png?v=3", DEFAULT_HREF)).toEqual({
      href: "/uploads/layout/f.png?v=3",
      type: "image/png",
      isDefault: false,
    });
  });
});

/* ================================================================== */
/*  Head wiring — structural                                          */
/* ================================================================== */

describe("pages/+Head.tsx", () => {
  const head = read("pages/+Head.tsx");

  it("declares exactly one icon and no competing icon tags", () => {
    expect(head.match(/<link rel='icon'/g)?.length).toBe(1);
    expect(head).not.toContain("shortcut icon");
    expect(head).not.toContain("apple-touch-icon");
    expect(head).not.toContain('rel="manifest"');
    expect(head).not.toContain("rel='manifest'");
  });

  it("is the only icon declaration in the app", () => {
    // A second rel="icon" anywhere — another page's Head, an HTML shell, a web
    // manifest — reintroduces browser-specific precedence and with it the
    // original symptom.
    for (const file of ["pages/+config.ts", "layouts/LayoutDefault.tsx"]) {
      expect(read(file)).not.toContain("rel='icon'");
      expect(read(file)).not.toContain('rel="icon"');
    }
  });

  it("renders the resolver's href and type, not a hand-rolled ladder", () => {
    expect(head).toContain("resolveFavicon(layoutSettings?.faviconUrl");
    expect(head).toContain("href={favicon.href}");
    expect(head).toContain("type={favicon.type}");
    // No extension ladder left in the favicon path — the og:image block has
    // its own, which is a different image and not what this covers.
    expect(head).not.toContain("layoutSettings.faviconUrl.endsWith");
  });

  it("reads the favicon from template-scoped SSR layout settings", () => {
    // The admin saves against the active landing template; SSR must read the
    // same row, or the favicon would persist into a template nobody serves.
    expect(head).toContain("pageContext.layoutSettingsData");
    for (const loader of ["server/server.ts", "server/vike-handler.ts"]) {
      const source = read(loader);
      expect(source).toContain("templateSelection?.landing");
      expect(source).toContain("getLayoutSettingsRaw(");
    }
    const admin = read("pages/dashboard/admin/layout-settings/+Page.tsx");
    expect(admin).toContain('getTemplateId("landing")');
    expect(admin).toContain("templateId: selectedTemplateId");
  });

  it("keeps the tab icon current across client-side navigation", () => {
    // Vike's client router swaps pages without a document reload. The effect
    // rewrites the existing link in place — it must not append a second one.
    expect(head).toContain("link[rel='icon']");
    expect(head).toContain('link.setAttribute("href", favicon.href)');
    expect(head).not.toContain("createElement(\"link\")");
    expect(head).not.toContain("appendChild");
  });
});

/* ================================================================== */
/*  Upload pipeline                                                   */
/* ================================================================== */

describe("favicon upload", () => {
  const uploader = read("backend/layout/upload-layout-image/index.ts");

  it("stores a favicon as the format the CMS control advertises", () => {
    // Logos still become .webp. A favicon does not — that is what produced a
    // .webp file behind a control labelled "PNG, SVG, or ICO".
    const faviconBranch = uploader.slice(
      uploader.indexOf('if (prefix === "favicon")'),
      uploader.indexOf('if (prefix === "share-image")'),
    );
    expect(faviconBranch).toContain(".png({");
    expect(faviconBranch).not.toContain(".webp({");
  });

  it("never crops a favicon", () => {
    // "cover" would cut the mark off at the edges of a square that is 16px on
    // screen. "contain" letterboxes a non-square source instead.
    const faviconBranch = uploader.slice(
      uploader.indexOf('if (prefix === "favicon")'),
      uploader.indexOf('if (prefix === "share-image")'),
    );
    expect(faviconBranch).toContain('fit: "contain"');
  });

  it("passes SVG and ICO through untouched", () => {
    expect(uploader).toContain('if (mimeType === "image/svg+xml")');
    expect(uploader).toContain('mimeType === "image/x-icon"');
    expect(uploader).toContain('mimeType === "image/vnd.microsoft.icon"');
  });

  it("accepts an ICO whose browser-reported type is missing", () => {
    // Chrome on Windows commonly reports File.type as "" for .ico, which used
    // to fail the allow-list even though the control offers ICO.
    expect(uploader).toContain("function resolveMimeType(");
    expect(uploader).toContain('ico: "image/x-icon"');
    expect(uploader).toContain("fileName?: string");
    expect(read("backend/layout/trpc.ts")).toContain(
      "fileName: input.file.name",
    );
  });

  it("tells the admin what the formats actually do", () => {
    const admin = read("pages/dashboard/admin/layout-settings/+Page.tsx");
    expect(admin).toContain("SVG and ICO files are stored exactly as uploaded");
    expect(admin).toContain("converted to a 180×180 PNG");
    // And the error message no longer omits ICO from the accepted list.
    expect(uploader).toContain(
      "Only JPG, PNG, WebP, SVG and ICO are allowed.",
    );
  });

  it("saves the favicon on the same settings object as everything else", () => {
    // One Save writes the whole layout-settings row, so a favicon save cannot
    // drop the navigation, logos or copy sitting beside it.
    const admin = read("pages/dashboard/admin/layout-settings/+Page.tsx");
    expect(admin).toContain(
      "setSettings((prev) => ({ ...prev, faviconUrl: result.data!.url }))",
    );
    expect(admin).toContain("content: settings,");
    // And the read path preserves every other field when merging defaults.
    for (const loader of [
      "backend/layout/get-layout-settings/index.ts",
      "backend/layout/get-layout-settings-raw.ts",
    ]) {
      const source = read(loader);
      expect(source).toContain("faviconUrl: stored.faviconUrl ?? base.faviconUrl");
      expect(source).toContain("siteTitle: stored.siteTitle ?? base.siteTitle");
      expect(source).toContain("...stored.header");
      expect(source).toContain("...stored.footer");
    }
  });
});
