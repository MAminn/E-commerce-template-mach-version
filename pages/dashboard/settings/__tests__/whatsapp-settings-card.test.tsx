// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeWhatsAppSettings,
  validateWhatsAppSettings,
  type WhatsAppSettings,
} from "#root/shared/whatsapp/config";
import { WhatsAppSettingsCard } from "../WhatsAppSettingsCard";

/**
 * The WhatsApp card must show the shipped default (off) plainly, refuse to
 * enable without a valid international number, and save the normalised one.
 */

let stored: Partial<WhatsAppSettings> | null = null;
const updateSettings = vi.fn(async (input: WhatsAppSettings) => {
  // Server behaviour: validate, then store the canonical form.
  const v = validateWhatsAppSettings(input);
  if (!v.ok) return { success: false as const, error: Object.values(v.errors)[0] };
  stored = v.settings;
  return { success: true as const, result: v.settings };
});

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    whatsapp: {
      getSettings: {
        query: async () => ({ success: true, result: normalizeWhatsAppSettings(stored) }),
      },
      updateSettings: { mutate: (input: WhatsAppSettings) => updateSettings(input) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  stored = null;
  updateSettings.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderCard() {
  await act(async () => {
    root.render(<WhatsAppSettingsCard />);
  });
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);

/** React tracks input values itself; set through the native setter so onChange fires. */
async function type(sel: string, value: string) {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel)!;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function save() {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    /Save WhatsApp Settings/.test(b.textContent ?? ""),
  )!;
  await act(async () => {
    btn.click();
  });
}

async function toggleEnabled() {
  await act(async () => {
    q<HTMLButtonElement>("#whatsappEnabled")!.click();
  });
}

describe("WhatsAppSettingsCard", () => {
  it("a fresh store shows Off, an empty number and Both", async () => {
    await renderCard();
    expect(q("[data-testid=whatsapp-status-badge]")!.textContent).toBe("Off");
    expect(q("#whatsappEnabled")!.getAttribute("aria-checked")).toBe("false");
    expect(q<HTMLInputElement>("#whatsappPhone")!.value).toBe("");
    expect(q("#whatsappVisibility")!.textContent).toContain("Mobile and desktop");
    expect(q("[data-testid=whatsapp-link-preview]")).toBeNull();
  });

  it("enabling with no number is rejected inline and nothing is saved", async () => {
    await renderCard();
    await toggleEnabled();
    await save();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(q("[data-testid=whatsapp-phone-error]")!.textContent).toMatch(/required to turn the button on/);
    expect(q("#whatsappPhone")!.getAttribute("aria-invalid")).toBe("true");
    expect(q("[data-testid=whatsapp-status-badge]")!.textContent).toBe("Off");
  });

  it("enabling with a local number (no country code) is rejected", async () => {
    await renderCard();
    await toggleEnabled();
    await type("#whatsappPhone", "01012345678");
    await save();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(q("[data-testid=whatsapp-phone-error]")!.textContent).toMatch(/country code/);
  });

  it("a valid formatted number saves as digits and flips the status to On", async () => {
    await renderCard();
    await toggleEnabled();
    await type("#whatsappPhone", "+20 10 1234 5678");
    await type("#whatsappMessage", "Hi MACH");
    expect(q("[data-testid=whatsapp-link-preview]")!.textContent).toBe(
      "https://wa.me/201012345678?text=Hi%20MACH",
    );
    await save();
    expect(updateSettings).toHaveBeenCalledWith({
      enabled: true,
      phoneNumber: "201012345678",
      message: "Hi MACH",
      visibility: "both",
    });
    expect(q("[data-testid=whatsapp-status-badge]")!.textContent).toBe("On");
    expect(q<HTMLInputElement>("#whatsappPhone")!.value).toBe("201012345678");
  });

  it("can be saved off with an empty number", async () => {
    await renderCard();
    await save();
    expect(updateSettings).toHaveBeenCalledWith({
      enabled: false,
      phoneNumber: "",
      message: "",
      visibility: "both",
    });
  });

  it("an owner who already enabled it sees On with their settings", async () => {
    stored = { enabled: true, phoneNumber: "201012345678", message: "", visibility: "mobile" };
    await renderCard();
    expect(q("[data-testid=whatsapp-status-badge]")!.textContent).toBe("On");
    expect(q("#whatsappVisibility")!.textContent).toContain("Mobile only");
  });
});
