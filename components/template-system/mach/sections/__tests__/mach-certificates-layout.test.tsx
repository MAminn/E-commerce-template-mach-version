import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type CertificateItem,
  type HomepageCertificatesContent,
} from "#root/shared/types/homepage-content";
import { MachCertificates } from "../MachCertificates";

/**
 * How the certificate strip lays out, read from the static markup.
 *
 * Phones run two documents across instead of stacking them; the `sm:` and
 * `lg:` classes that size the tablet and desktop strip must be exactly what
 * they were. Both halves are pinned here so a phone fix cannot quietly move
 * the desktop layout, and the other way round.
 */

function certificate(n: number): CertificateItem {
  return {
    id: `cert-${n}`,
    title: `Certificate ${n}`,
    issuer: "ABS Global",
    thumbnailUrl: `/uploads/homepage/certificate-${n}.webp`,
  };
}

function render(count: number): string {
  const content: HomepageCertificatesContent = {
    ...(DEFAULT_HOMEPAGE_CONTENT.certificates as HomepageCertificatesContent),
    enabled: true,
    items: Array.from({ length: count }, (_, i) => certificate(i + 1)),
  };
  return renderToStaticMarkup(<MachCertificates content={content} />);
}

/** The class list of the grid that holds the documents. */
function gridClasses(html: string): string[] {
  const match = html.match(/class="(mx-auto grid w-fit[^"]*)"/);
  return match?.[1]?.split(/\s+/) ?? [];
}

function figureClasses(html: string): string[] {
  const match = html.match(/<figure class="([^"]*)"/);
  return match?.[1]?.split(/\s+/) ?? [];
}

function imageClasses(html: string): string[] {
  const match = html.match(/<img [^>]*class="([^"]*)"/);
  return match?.[1]?.split(/\s+/) ?? [];
}

describe("MachCertificates — phone layout", () => {
  it("puts two certificates side by side below the sm breakpoint", () => {
    const grid = gridClasses(render(2));
    expect(grid).toContain("grid-cols-2");
    expect(grid).not.toContain("grid-cols-1");
  });

  it("keeps a third and fourth certificate two across on a phone", () => {
    expect(gridClasses(render(3))).toContain("grid-cols-2");
    expect(gridClasses(render(4))).toContain("grid-cols-2");
  });

  it("still centres a lone certificate in a single column", () => {
    expect(gridClasses(render(1))).toContain("grid-cols-1");
  });

  it("caps the phone card and document smaller than the desktop ones", () => {
    const html = render(2);
    expect(figureClasses(html)).toContain("max-w-[160px]");
    expect(imageClasses(html)).toContain("max-h-[280px]");
    expect(gridClasses(html)).toEqual(
      expect.arrayContaining(["gap-x-4", "gap-y-5"]),
    );
  });
});

describe("MachCertificates — tablet and desktop are unchanged", () => {
  it("keeps the two-up sm/lg sizing", () => {
    const html = render(2);
    expect(figureClasses(html)).toEqual(
      expect.arrayContaining(["sm:max-w-[260px]", "lg:max-w-[274px]"]),
    );
    expect(imageClasses(html)).toEqual(
      expect.arrayContaining(["sm:max-h-[430px]", "lg:max-h-[450px]"]),
    );
    expect(gridClasses(html)).toEqual(
      expect.arrayContaining(["sm:gap-x-10", "sm:gap-y-7"]),
    );
  });

  it("keeps the three- and four-up desktop columns", () => {
    expect(gridClasses(render(3))).toContain("lg:grid-cols-3");
    expect(gridClasses(render(4))).toContain("lg:grid-cols-4");
  });
});
