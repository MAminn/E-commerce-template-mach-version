import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * These pages are wrapped in `MachChrome`, which renders the Mach footer, whose
 * links read the current path from Vike's page context. There is no Vike render
 * in a unit test, so stand one in — the footer is deliberately part of what's
 * under test here (a Mach content page must not end up under the generic site
 * footer), so stubbing it out entirely would hide the thing worth checking.
 */
vi.mock("vike-react/usePageContext", () => ({
  usePageContext: () => ({ urlPathname: "/about-us" }),
}));
import {
  resolveAboutPage,
  resolveReturnPolicyPage,
  type AboutPageView,
  type ReturnPolicyPageView,
} from "#root/shared/types/content-pages";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  ValuePropIconType,
} from "#root/shared/types/homepage-content";
import { MachAboutPage } from "../MachAboutPage";
import { MachReturnPolicyPage } from "../MachReturnPolicyPage";
import { MachPageUnavailable } from "../MachPageShell";

/**
 * The Mach renderings of /about-us and /return-policy.
 *
 * Rendered to static markup: these are presentation components over a resolved
 * view model, so what matters is that the client's words end up on the page and
 * that nothing is invented around them. The contact page is excluded here — its
 * form is stateful and its behaviour is covered where the mutation is.
 */

function aboutView(overrides: Partial<AboutPageView> = {}): AboutPageView {
  return {
    title: "About Mach",
    paragraphs: ["We make supplements.", "We test every batch."],
    imageUrl: null,
    ...overrides,
  };
}

function policyView(
  overrides: Partial<ReturnPolicyPageView> = {},
): ReturnPolicyPageView {
  return {
    title: "Return Policy",
    intro: "If something's not right, we're here to help.",
    steps: [
      {
        icon: ValuePropIconType.PACKAGE,
        title: "1. Return Window",
        description: "14 days from delivery.",
      },
    ],
    detailSections: [
      { title: "Non-Returnable Items", body: "Opened supplement containers." },
    ],
    help: {
      prefix: "Need help? Reach us at",
      supportEmail: "help@machsupplements.com",
      middle: "or via our",
      contactLink: { label: "Contact Us page", url: "/contact" },
    },
    ...overrides,
  };
}

/* ================================================================== */
/*  About                                                             */
/* ================================================================== */

describe("MachAboutPage", () => {
  it("renders the CMS title and every paragraph", () => {
    const html = renderToStaticMarkup(<MachAboutPage view={aboutView()} />);
    expect(html).toContain("About Mach");
    expect(html).toContain("We make supplements.");
    expect(html).toContain("We test every batch.");
  });

  it("renders the CMS image when there is one, and no empty frame when there is not", () => {
    expect(
      renderToStaticMarkup(<MachAboutPage view={aboutView()} />),
    ).not.toContain("<img");
    const withImage = renderToStaticMarkup(
      <MachAboutPage view={aboutView({ imageUrl: "/uploads/team.webp" })} />,
    );
    expect(withImage).toContain('src="/uploads/team.webp"');
    expect(withImage).toContain('alt="About Mach"');
  });

  it("puts the title in an h1 exactly once", () => {
    const html = renderToStaticMarkup(<MachAboutPage view={aboutView()} />);
    expect(html.match(/<h1/g)?.length).toBe(1);
  });

  it("writes no copy of its own", () => {
    // Everything visible in the body of an About page has to come from the
    // CMS — the footer below it is layout settings' business, not this page's.
    const html = renderToStaticMarkup(
      <MachAboutPage view={aboutView({ paragraphs: ["Only this."] })} />,
    );
    const body = html.split("<footer")[0] ?? "";
    expect(body).toContain("Only this.");
    expect(body).not.toContain("Lorem");
    expect(body).not.toContain("coming soon");
    expect(body).not.toContain("Mach Supplements exists to fuel");
  });

  it("carries the Mach footer, not the generic site footer", () => {
    // MachChrome is what puts it there and what suppresses #global-footer.
    // Without it these pages would sit under the default template's footer
    // while wearing Mach navigation.
    const html = renderToStaticMarkup(<MachAboutPage view={aboutView()} />);
    expect(html).toContain('class="bg-[var(--mach-ink)] text-white/60"');
    expect(html).not.toContain('id="global-footer"');
    // And that footer's own links point at the three routes this change fixed.
    expect(html).toContain('href="/about-us"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/return-policy"');
  });
});

/* ================================================================== */
/*  Return policy                                                     */
/* ================================================================== */

describe("MachReturnPolicyPage", () => {
  it("renders the intro, every step and every detail section", () => {
    const html = renderToStaticMarkup(
      <MachReturnPolicyPage view={policyView()} />,
    );
    expect(html).toContain("Return Policy");
    expect(html).toContain("we&#x27;re here to help");
    expect(html).toContain("1. Return Window");
    expect(html).toContain("14 days from delivery.");
    expect(html).toContain("Non-Returnable Items");
    expect(html).toContain("Opened supplement containers.");
  });

  it("renders the shipped default policy end to end", () => {
    const view = resolveReturnPolicyPage(
      DEFAULT_HOMEPAGE_CONTENT.returnPolicy,
      "en",
    );
    expect(view).not.toBeNull();
    const html = renderToStaticMarkup(
      <MachReturnPolicyPage view={view as ReturnPolicyPageView} />,
    );
    expect(html).toContain("1. Return Window");
    expect(html).toContain("4. Refunds");
    // supportEmail ships blank, so no mailto: to nobody.
    expect(html).not.toContain('href="mailto:"');
  });

  it("links the support address only when there is one", () => {
    const withEmail = renderToStaticMarkup(
      <MachReturnPolicyPage view={policyView()} />,
    );
    expect(withEmail).toContain('href="mailto:help@machsupplements.com"');

    const withoutEmail = renderToStaticMarkup(
      <MachReturnPolicyPage
        view={policyView({
          help: {
            prefix: "Need help?",
            supportEmail: null,
            middle: "or via our",
            contactLink: { label: "Contact Us page", url: "/contact" },
          },
        })}
      />,
    );
    expect(withoutEmail).not.toContain("mailto:");
    expect(withoutEmail).toContain('href="/contact"');
  });

  it("omits the help line entirely when there is nothing to offer", () => {
    const html = renderToStaticMarkup(
      <MachReturnPolicyPage view={policyView({ help: null })} />,
    );
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("Need help?");
  });

  it("renders the steps in the order the CMS stores them", () => {
    const html = renderToStaticMarkup(
      <MachReturnPolicyPage
        view={policyView({
          steps: [
            { icon: ValuePropIconType.PACKAGE, title: "First", description: "a" },
            { icon: ValuePropIconType.PAYMENT, title: "Second", description: "b" },
          ],
        })}
      />,
    );
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
  });
});

/* ================================================================== */
/*  Unpublished                                                       */
/* ================================================================== */

describe("MachPageUnavailable", () => {
  it("does not claim the route does not exist", () => {
    // The route exists and the navigation links to it. Saying otherwise is
    // the bug this whole change removes.
    const html = renderToStaticMarkup(
      <MachPageUnavailable
        title='About'
        message='This page is not available yet'
      />,
    );
    expect(html).not.toContain("Page not found");
    expect(html).not.toContain("404");
    expect(html).toContain("This page is not available yet");
  });

  it("offers a way onward rather than a dead end", () => {
    const html = renderToStaticMarkup(
      <MachPageUnavailable title='About' message='Not available yet' />,
    );
    expect(html).toContain('href="/shop"');
  });

  it("invents no replacement copy", () => {
    const html = renderToStaticMarkup(
      <MachPageUnavailable title='About' message='Not available yet' />,
    );
    expect(html).not.toContain("Mach Supplements exists to fuel");
  });
});

/* ================================================================== */
/*  About resolution → rendering, end to end                          */
/* ================================================================== */

describe("about page, CMS to markup", () => {
  it("renders exactly what Dashboard → Homepage → About Us Page holds", () => {
    const view = resolveAboutPage(
      {
        enabled: true,
        title: "Built In Cairo",
        description: "Since 2019.\nEvery batch third-party tested.",
        imageUrl: "gym.webp",
      },
      "en",
    );
    const html = renderToStaticMarkup(
      <MachAboutPage view={view as AboutPageView} />,
    );
    expect(html).toContain("Built In Cairo");
    expect(html).toContain("Since 2019.");
    expect(html).toContain("Every batch third-party tested.");
    expect(html).toContain('src="/uploads/gym.webp"');
  });
});
