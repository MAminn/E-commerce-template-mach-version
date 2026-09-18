import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT_SETTINGS,
  resolveContactEmail,
  type LayoutSettings,
  type NavbarStyle,
} from "../layout-settings";

/**
 * Where a storefront enquiry is delivered.
 *
 * One address, stored in two places, because the two templates render it in
 * two places — and Layout Settings only shows the field its own chrome uses.
 * The Minimal info-bar card is gated to `navbarStyle === "minimal"`; the
 * Footer Contact Info card is shown for "minimal" and "editorial". So on Mach
 * the footer field is the only one an admin can reach.
 *
 * Preferring the header field on Mach meant a value left behind by an earlier
 * Minimal configuration — or inherited from the legacy "default" layout row —
 * silently beat the one on screen, delivering enquiries to an address that
 * could not be corrected from the dashboard. Precedence now follows whichever
 * field the storefront actually shows.
 */

const ROOT = path.resolve(__dirname, "../..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

function settings({
  navbarStyle,
  header,
  footer,
}: {
  navbarStyle: NavbarStyle;
  header?: string;
  footer?: string;
}): LayoutSettings {
  return {
    ...DEFAULT_LAYOUT_SETTINGS,
    header: {
      ...DEFAULT_LAYOUT_SETTINGS.header,
      navbarStyle,
      contactEmail: header,
    },
    footer: {
      ...DEFAULT_LAYOUT_SETTINGS.footer,
      contactEmail: footer,
    },
  };
}

/* ================================================================== */
/*  Mach / editorial                                                  */
/* ================================================================== */

describe("editorial (Mach)", () => {
  it("prefers the footer email — the only field the Mach admin can edit", () => {
    expect(
      resolveContactEmail(
        settings({
          navbarStyle: "editorial",
          header: "stale@old-minimal.example",
          footer: "cs@machsupplements.com",
        }),
      ),
    ).toBe("cs@machsupplements.com");
  });

  it("falls back to the header email when the footer field is empty", () => {
    // A store that only ever filled in the header field keeps working rather
    // than starting to fail the moment precedence changed.
    for (const footer of ["", "   ", undefined]) {
      expect(
        resolveContactEmail(
          settings({
            navbarStyle: "editorial",
            header: "cs@machsupplements.com",
            footer,
          }),
        ),
      ).toBe("cs@machsupplements.com");
    }
  });
});

/* ================================================================== */
/*  Minimal                                                           */
/* ================================================================== */

describe("minimal", () => {
  it("prefers the header email — the info bar field Minimal exposes", () => {
    expect(
      resolveContactEmail(
        settings({
          navbarStyle: "minimal",
          header: "hello@minimal.example",
          footer: "footer@minimal.example",
        }),
      ),
    ).toBe("hello@minimal.example");
  });

  it("falls back to the footer email when the header field is empty", () => {
    for (const header of ["", "   ", undefined]) {
      expect(
        resolveContactEmail(
          settings({
            navbarStyle: "minimal",
            header,
            footer: "footer@minimal.example",
          }),
        ),
      ).toBe("footer@minimal.example");
    }
  });
});

/* ================================================================== */
/*  Default chrome and the unconfigured case                          */
/* ================================================================== */

describe("default navbar", () => {
  it("keeps the historical header-first order", () => {
    // The default navbar exposes neither field, so whatever it has is
    // inherited either way — changing the order here would only churn.
    expect(
      resolveContactEmail(
        settings({
          navbarStyle: "default",
          header: "a@example.com",
          footer: "b@example.com",
        }),
      ),
    ).toBe("a@example.com");
    expect(
      resolveContactEmail(
        settings({ navbarStyle: "default", footer: "b@example.com" }),
      ),
    ).toBe("b@example.com");
  });
});

describe("nothing configured", () => {
  it("resolves to undefined for every navbar style", () => {
    for (const navbarStyle of [
      "editorial",
      "minimal",
      "default",
    ] as NavbarStyle[]) {
      expect(resolveContactEmail(settings({ navbarStyle }))).toBeUndefined();
      expect(
        resolveContactEmail(
          settings({ navbarStyle, header: "  ", footer: "" }),
        ),
      ).toBeUndefined();
    }
  });

  it("is the shipped state — both fields default to empty", () => {
    expect(DEFAULT_LAYOUT_SETTINGS.header.contactEmail).toBe("");
    expect(DEFAULT_LAYOUT_SETTINGS.footer.contactEmail).toBeUndefined();
  });

  it("still returns the existing safe error rather than sending nowhere", () => {
    // The mutation's guard is unchanged: an unresolved address short-circuits
    // before any mail is built or sent, with the message it has always used.
    const router = read("backend/contact/trpc.ts");
    expect(router).toContain("const contactEmail = resolveContactEmail(layoutSettings);");
    const guard = router.slice(router.indexOf("if (!contactEmail)"));
    expect(guard).toContain("success: false as const");
    expect(guard).toContain(
      'error: "Contact email not configured. Please try again later."',
    );
    // The guard must come before the send.
    expect(router.indexOf("if (!contactEmail)")).toBeLessThan(
      router.indexOf("emailService.sendEmail"),
    );
  });
});

/* ================================================================== */
/*  Wiring — the resolver is the only precedence in the codebase       */
/* ================================================================== */

describe("wiring", () => {
  it("is what the mutation uses — no second precedence rule", () => {
    const router = read("backend/contact/trpc.ts");
    expect(router).toContain("resolveContactEmail");
    expect(router).not.toContain("layoutSettings.header.contactEmail");
    expect(router).not.toContain("layoutSettings.footer.contactEmail");
  });

  it("reads settings for the active landing template", () => {
    const router = read("backend/contact/trpc.ts");
    expect(router).not.toContain('"landing-minimal"');
    expect(router).toContain("getTemplateSelectionRaw(ctx.db)");
  });

  it("adds no new CMS field — both inputs already existed", () => {
    // The fix is a precedence change, not a new setting. Layout Settings still
    // offers exactly the two contact-email inputs it always has.
    const admin = read("pages/dashboard/admin/layout-settings/+Page.tsx");
    expect(admin.match(/updateHeader\("contactEmail"/g)?.length).toBe(1);
    expect(admin.match(/updateFooter\("contactEmail"/g)?.length).toBe(1);
    // And the schema is unchanged in shape.
    const layoutRouter = read("backend/layout/trpc.ts");
    expect(layoutRouter.match(/contactEmail: z\.string\(\)\.optional\(\)/g)?.length).toBe(2);
  });

  it("matches which card each storefront actually shows", () => {
    // If these gates ever move, the precedence above has to move with them.
    const admin = read("pages/dashboard/admin/layout-settings/+Page.tsx");
    // Info Bar — Contact Email: minimal only.
    expect(admin).toContain(
      "{settings.header.navbarStyle === \"minimal\" && (",
    );
    // Footer Contact Info: minimal and editorial.
    expect(admin.replace(/\s+/g, " ")).toContain(
      '{(settings.header.navbarStyle === "minimal" || settings.header.navbarStyle === "editorial") && (',
    );
  });
});
