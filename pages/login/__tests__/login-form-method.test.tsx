// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
// happy-dom's own navigator: every native form submission and every
// `location.href = …` goes through it, so spying here sees exactly what the
// browser would request — without fetching anything.
import BrowserFrameNavigator from "happy-dom/lib/browser/utilities/BrowserFrameNavigator.js";

/**
 * Sign-in forms must never put credentials in a URL.
 *
 * Before hydration a <form> is plain HTML: pressing Enter or the submit button
 * performs the browser's native submission, and without a `method` that is a
 * GET that serialises every named field — password included — into the query
 * string, the address bar, history and access logs. `method="post"` keeps the
 * fields in the request body (and the page catch-all rejects that body without
 * parsing or logging it). Once hydrated, react-hook-form's `handleSubmit`
 * prevents the native submission and signs in over fetch, as before.
 */

const page = { urlPathname: "/login" };
const layout = { header: { navbarStyle: "editorial" } };
const store = { supplement: true };
const signInEmail = vi.fn();
const toastError = vi.fn();

vi.mock("vike-react/usePageContext", () => ({ usePageContext: () => page }));
vi.mock("#root/frontend/contexts/LayoutSettingsContext", () => ({
  useLayoutSettings: () => layout,
}));
vi.mock("#root/shared/config/branding", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isSupplementStore: () => store.supplement,
}));
vi.mock("#root/lib/auth-client.js", () => ({
  authClient: { signIn: { email: signInEmail, social: vi.fn() } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn() },
}));

const { default: LoginPage } = await import("../+Page");
const { default: LoginForm } = await import("../components");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMAIL = "admin@mach.test";
const PASSWORD = "s3cret-Pass!";

type Variant = { name: string; setup: () => void };
const VARIANTS: Variant[] = [
  { name: "Mach (live storefront)", setup: () => { layout.header.navbarStyle = "editorial"; store.supplement = true; } },
  { name: "Minimal", setup: () => { layout.header.navbarStyle = "minimal"; store.supplement = true; } },
  { name: "Legacy", setup: () => { layout.header.navbarStyle = "editorial"; store.supplement = false; } },
];

let navigate: MockInstance<typeof BrowserFrameNavigator.navigate>;
let container: HTMLDivElement;
let root: Root | null;

/** Every URL the document tried to load, and whether it carried a form body. */
const navigations = () =>
  navigate.mock.calls.map(([o]) => ({
    url: String(o.url),
    method: String(o.method ?? "get").toLowerCase(),
    hasBody: Boolean(o.formData),
  }));

function setValue(input: HTMLInputElement, value: string) {
  // Through the prototype setter so React's value tracker sees the change.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function credentialsForm(): HTMLFormElement {
  const form = container.querySelector<HTMLFormElement>("form:has(input[name='password'])");
  if (!form) throw new Error("login form not rendered");
  return form;
}

function fill(form: HTMLFormElement) {
  const email = form.querySelector<HTMLInputElement>("input[name='email']");
  const password = form.querySelector<HTMLInputElement>("input[name='password']");
  if (!email || !password) throw new Error("credential inputs missing");
  setValue(email, EMAIL);
  setValue(password, PASSWORD);
}

function submitter(form: HTMLFormElement): HTMLButtonElement | undefined {
  return form.querySelector<HTMLButtonElement>("button[type='submit']") ?? undefined;
}

/** Server-rendered markup only — no React attached, i.e. before hydration. */
function renderUnhydrated(ui: React.ReactElement) {
  container.innerHTML = renderToString(ui);
}

beforeEach(() => {
  VARIANTS[0]?.setup();
  signInEmail.mockReset();
  toastError.mockReset();
  navigate = vi.spyOn(BrowserFrameNavigator, "navigate").mockResolvedValue(null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe.each(VARIANTS)("$name login form", ({ setup }) => {
  beforeEach(setup);

  it("declares method=post", () => {
    renderUnhydrated(<LoginPage />);
    const form = credentialsForm();
    expect(form.getAttribute("method")).toBe("post");
    expect(form.method).toBe("post");
  });

  it("a native (pre-hydration) submit keeps credentials out of the URL", () => {
    renderUnhydrated(<LoginPage />);
    const form = credentialsForm();
    fill(form);

    form.requestSubmit(submitter(form));

    const [nav] = navigations();
    expect(nav).toBeDefined();
    expect(nav?.method).toBe("post");
    expect(nav?.hasBody).toBe(true);
    expect(new URL(nav?.url ?? "").search).toBe("");
    expect(nav?.url).not.toContain(encodeURIComponent(PASSWORD));
    expect(nav?.url).not.toContain(encodeURIComponent(EMAIL));
  });

  it("hydrated: a valid sign-in goes through the auth client and redirects as before", async () => {
    signInEmail.mockResolvedValue({ data: { user: { role: "admin" } }, error: null });
    root = createRoot(container);
    act(() => root?.render(<LoginPage />));
    const form = credentialsForm();
    act(() => fill(form));

    await act(async () => {
      form.requestSubmit(submitter(form));
    });
    await vi.waitFor(() => expect(navigations().length).toBeGreaterThan(0));

    expect(signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, password: PASSWORD }),
    );
    const navs = navigations();
    // The only load is the post-login redirect — no native form submission.
    expect(navs).toHaveLength(1);
    expect(navs[0]?.hasBody).toBe(false);
    expect(new URL(navs[0]?.url ?? "", window.location.origin).pathname).toBe("/dashboard");
    expect(navs[0]?.url).not.toContain(encodeURIComponent(PASSWORD));
  });

  it("hydrated: an invalid sign-in shows an error and stays put", async () => {
    signInEmail.mockResolvedValue({ data: null, error: { message: "Invalid email or password" } });
    root = createRoot(container);
    act(() => root?.render(<LoginPage />));
    const form = credentialsForm();
    act(() => fill(form));

    await act(async () => {
      form.requestSubmit(submitter(form));
    });
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());

    expect(signInEmail).toHaveBeenCalledTimes(1);
    expect(navigations()).toHaveLength(0);
  });
});

describe("shared LoginForm (pages/login/components.tsx)", () => {
  it("declares method=post and a native submit is a body-only POST", () => {
    renderUnhydrated(<LoginForm onSubmit={async () => {}} />);
    const form = credentialsForm();
    expect(form.getAttribute("method")).toBe("post");
    fill(form);
    form.requestSubmit(submitter(form));
    const [nav] = navigations();
    expect(nav?.method).toBe("post");
    expect(new URL(nav?.url ?? "").search).toBe("");
  });
});

describe("harness control", () => {
  it("without method=post the same native submit WOULD leak the password", () => {
    renderUnhydrated(<LoginPage />);
    const form = credentialsForm();
    form.removeAttribute("method");
    fill(form);
    form.requestSubmit(submitter(form));
    const [nav] = navigations();
    expect(nav?.method).toBe("get");
    expect(new URL(nav?.url ?? "").searchParams.get("password")).toBe(PASSWORD);
  });
});

describe("every form with a password field posts", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const PASSWORD_INPUT = /type=\{[^}]*["']password["'][^}]*\}|type=["']password["']/;

  function* tsxFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) yield* tsxFiles(full);
      else if (name.endsWith(".tsx")) yield full;
    }
  }

  it("no <form> containing a password input lacks method=post", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const dir of ["pages", "components", "frontend", "layouts"]) {
      for (const file of tsxFiles(path.join(ROOT, dir))) {
        const src = readFileSync(file, "utf-8");
        // Each <form>…</form> block (forms don't nest), judged on its own
        // contents: a profile form beside a password form needs nothing.
        for (const block of src.match(/<form\b[\s\S]*?<\/form>/g) ?? []) {
          if (!PASSWORD_INPUT.test(block)) continue;
          const tag = block.match(/^<form\b[^>]*>/)?.[0] ?? block;
          checked++;
          if (!/\bmethod=\{?["']post["']\}?/i.test(tag)) {
            offenders.push(`${path.relative(ROOT, file)}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(11);
  });
});
