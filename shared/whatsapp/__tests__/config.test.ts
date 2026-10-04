import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WHATSAPP_MESSAGE_MAX_LENGTH,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
  normalizeWhatsAppSettings,
  toPublicWhatsAppButton,
  validateWhatsAppSettings,
  type WhatsAppSettings,
} from "../config";

const ON: WhatsAppSettings = {
  enabled: true,
  phoneNumber: "201012345678",
  message: "",
  visibility: "both",
};

describe("WhatsApp defaults", () => {
  it("ship off, with no number, no message, on both viewports", () => {
    expect(DEFAULT_WHATSAPP_SETTINGS).toEqual({
      enabled: false,
      phoneNumber: "",
      message: "",
      visibility: "both",
    });
  });

  it("a store with no saved config (NULL column) resolves to off and no button", () => {
    for (const raw of [null, undefined, {}, "garbage", 42]) {
      const settings = normalizeWhatsAppSettings(raw);
      expect(settings).toEqual(DEFAULT_WHATSAPP_SETTINGS);
      expect(toPublicWhatsAppButton(settings)).toBeNull();
    }
  });

  it("a partial row inherits the missing fields and drops wrong types", () => {
    expect(
      normalizeWhatsAppSettings({ enabled: true, phoneNumber: "201012345678", visibility: "tablet", message: 7 }),
    ).toEqual({ ...ON });
  });
});

describe("normalizeWhatsAppPhone", () => {
  it.each([
    ["+20 10 1234 5678", "201012345678"],
    ["201012345678", "201012345678"],
    ["+201012345678", "201012345678"],
    ["  +20-10-1234-5678  ", "201012345678"],
    ["+20 (10) 1234.5678", "201012345678"],
    ["00201012345678", "201012345678"],
    ["+1 415 555 2671", "14155552671"],
    ["+971 50 123 4567", "971501234567"],
  ])("%s → %s", (input, digits) => {
    expect(normalizeWhatsAppPhone(input)).toEqual({ ok: true, digits });
  });

  it.each([
    ["", /Enter a WhatsApp number/],
    ["   ", /Enter a WhatsApp number/],
    ["01012345678", /country code/],
    ["+0201012345678", /country code/],
    ["00 010 1234 5678", /country code/],
    ["20 10 12ab 5678", /digits only/],
    ["20+1012345678", /digits only/],
    ["++201012345678", /digits only/],
    ["wa.me/201012345678", /digits only/],
    ["+20 1234", /8–15 digits/],
    ["+1234567890123456", /8–15 digits/],
  ])("rejects %j", (input, message) => {
    const r = normalizeWhatsAppPhone(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("never invents a country code for a local number", () => {
    // An Egyptian local 010 number must be rejected, not turned into 2010….
    const r = normalizeWhatsAppPhone("010 1234 5678");
    expect(r.ok).toBe(false);
  });
});

describe("validateWhatsAppSettings", () => {
  it("off with an empty number is valid", () => {
    expect(validateWhatsAppSettings({ ...DEFAULT_WHATSAPP_SETTINGS })).toEqual({
      ok: true,
      settings: DEFAULT_WHATSAPP_SETTINGS,
    });
  });

  it("enabling without a number is rejected with a clear message", () => {
    const r = validateWhatsAppSettings({ ...ON, phoneNumber: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.phoneNumber).toMatch(/required to turn the button on/);
  });

  it("enabling with an invalid number is rejected", () => {
    const r = validateWhatsAppSettings({ ...ON, phoneNumber: "01012345678" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.phoneNumber).toMatch(/country code/);
  });

  it("an invalid non-empty number is rejected even while off, so nothing malformed is stored", () => {
    const r = validateWhatsAppSettings({ ...DEFAULT_WHATSAPP_SETTINGS, phoneNumber: "abc" });
    expect(r.ok).toBe(false);
  });

  it("stores the number as digits and the message trimmed", () => {
    expect(
      validateWhatsAppSettings({
        enabled: true,
        phoneNumber: "+20 10 1234 5678",
        message: "  Hi MACH  ",
        visibility: "mobile",
      }),
    ).toEqual({
      ok: true,
      settings: {
        enabled: true,
        phoneNumber: "201012345678",
        message: "Hi MACH",
        visibility: "mobile",
      },
    });
  });

  it("rejects an over-long message and an unknown visibility", () => {
    const r = validateWhatsAppSettings({
      ...ON,
      message: "x".repeat(WHATSAPP_MESSAGE_MAX_LENGTH + 1),
      visibility: "tablet" as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.message).toBeDefined();
      expect(r.errors.visibility).toBeDefined();
    }
  });
});

describe("buildWhatsAppUrl", () => {
  it("no message → a clean wa.me URL with no query string", () => {
    expect(buildWhatsAppUrl("201012345678")).toBe("https://wa.me/201012345678");
    expect(buildWhatsAppUrl("201012345678", "   ")).toBe("https://wa.me/201012345678");
  });

  it("normalises a formatted number into the path", () => {
    expect(buildWhatsAppUrl("+20 10 1234 5678")).toBe("https://wa.me/201012345678");
  });

  it("URL-encodes the message as ?text=", () => {
    const url = buildWhatsAppUrl("201012345678", "Hi MACH! Is Whey & Creatine in stock? 100% ✓\nThanks");
    expect(url).toBe(
      "https://wa.me/201012345678?text=Hi%20MACH!%20Is%20Whey%20%26%20Creatine%20in%20stock%3F%20100%25%20%E2%9C%93%0AThanks",
    );
    // Round-trips exactly.
    expect(new URL(url!).searchParams.get("text")).toBe(
      "Hi MACH! Is Whey & Creatine in stock? 100% ✓\nThanks",
    );
  });

  it("encodes Arabic text", () => {
    const url = buildWhatsAppUrl("201012345678", "مرحبا");
    expect(new URL(url!).searchParams.get("text")).toBe("مرحبا");
  });

  it("refuses to build a link for an invalid number", () => {
    expect(buildWhatsAppUrl("")).toBeNull();
    expect(buildWhatsAppUrl("01012345678", "hi")).toBeNull();
    expect(buildWhatsAppUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("toPublicWhatsAppButton", () => {
  it("off → null even with a valid number", () => {
    expect(toPublicWhatsAppButton({ ...ON, enabled: false })).toBeNull();
  });

  it("on with a hand-edited bad number → null, never a broken link", () => {
    expect(toPublicWhatsAppButton({ ...ON, phoneNumber: "0101234" })).toBeNull();
  });

  it("on with a valid number → href and visibility only", () => {
    expect(toPublicWhatsAppButton({ ...ON, message: "Hi", visibility: "desktop" })).toEqual({
      href: "https://wa.me/201012345678?text=Hi",
      visibility: "desktop",
    });
  });
});
