/**
 * Floating WhatsApp button — the single source of truth for its settings,
 * phone-number normalisation and the click-to-chat link.
 *
 * This is click-to-chat only: the storefront renders a plain
 * `https://wa.me/<digits>` link that the shopper chooses to open. Nothing here
 * sends a message, talks to the WhatsApp Business API or touches orders.
 *
 * The settings live in `store_settings.whatsapp_config`. It is its own column,
 * deliberately separate from the footer's contact phone. A NULL or partial
 * row inherits the defaults below, so the button ships OFF and new fields
 * never need a data migration.
 */

export const WHATSAPP_VISIBILITIES = ["both", "mobile", "desktop"] as const;
export type WhatsAppVisibility = (typeof WHATSAPP_VISIBILITIES)[number];

/** Longest prefilled message accepted. Far below any URL limit. */
export const WHATSAPP_MESSAGE_MAX_LENGTH = 500;

/**
 * E.164 bounds on the digits wa.me receives (country code included). The
 * standard caps a number at 15 digits; nothing shorter than 8 is a real
 * international mobile number.
 */
export const WHATSAPP_PHONE_MIN_DIGITS = 8;
export const WHATSAPP_PHONE_MAX_DIGITS = 15;

export interface WhatsAppSettings {
  /** Master switch. Off = no button anywhere. */
  enabled: boolean;
  /** International number as digits only, country code first (e.g. 201012345678). Empty while unset. */
  phoneNumber: string;
  /** Optional prefilled chat text. Empty = a bare wa.me link. */
  message: string;
  /** Which viewports show the button. Mobile is below the `lg` breakpoint (1024px). */
  visibility: WhatsAppVisibility;
}

/**
 * Ships OFF with no number. Production has no WhatsApp number yet; the owner
 * enters it in Settings → WhatsApp and switches the button on.
 */
export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: false,
  phoneNumber: "",
  message: "",
  visibility: "both",
};

export type WhatsAppPhoneResult =
  | { ok: true; digits: string }
  | { ok: false; error: string };

/**
 * Turns an international number as a person would type it into the digits
 * wa.me expects: `+20 10 1234 5678` → `201012345678`.
 *
 * Accepted: an optional leading `+` or `00` international prefix, then digits
 * separated by spaces, dashes, dots or parentheses. Rejected outright:
 * letters or any other character, a `+` anywhere but the start, and a number
 * that starts with 0 once the prefix is gone — that is a local number with
 * its trunk prefix (e.g. Egyptian `010…`), and guessing its country code
 * would be inventing one.
 */
export function normalizeWhatsAppPhone(raw: string): WhatsAppPhoneResult {
  const input = raw.trim();
  if (input === "") {
    return { ok: false, error: "Enter a WhatsApp number." };
  }
  if (!/^\+?[\d\s().-]+$/.test(input)) {
    return {
      ok: false,
      error:
        "Use digits only, with an optional leading +. Spaces and dashes are fine.",
    };
  }

  let digits = input.replace(/\D/g, "");
  if (!input.startsWith("+") && digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0")) {
    return {
      ok: false,
      error:
        "Include the country code and drop the leading 0 — e.g. 201012345678 for an Egyptian 010 number.",
    };
  }
  if (
    digits.length < WHATSAPP_PHONE_MIN_DIGITS ||
    digits.length > WHATSAPP_PHONE_MAX_DIGITS
  ) {
    return {
      ok: false,
      error: `A full international number has ${WHATSAPP_PHONE_MIN_DIGITS}–${WHATSAPP_PHONE_MAX_DIGITS} digits including the country code.`,
    };
  }
  return { ok: true, digits };
}

export type WhatsAppValidationResult =
  | { ok: true; settings: WhatsAppSettings }
  | {
      ok: false;
      errors: Partial<Record<"phoneNumber" | "message" | "visibility", string>>;
    };

/**
 * Strict check for a save from the CMS. Returns the canonical settings to
 * store (number reduced to digits, message trimmed) or per-field errors.
 *
 * An empty number is allowed only while the button is off. A non-empty
 * number must always be valid, so nothing malformed is ever stored.
 */
export function validateWhatsAppSettings(
  input: WhatsAppSettings,
): WhatsAppValidationResult {
  const errors: Partial<
    Record<"phoneNumber" | "message" | "visibility", string>
  > = {};

  let phoneNumber = "";
  if (input.phoneNumber.trim() === "") {
    if (input.enabled) {
      errors.phoneNumber =
        "A WhatsApp number is required to turn the button on.";
    }
  } else {
    const phone = normalizeWhatsAppPhone(input.phoneNumber);
    if (phone.ok) phoneNumber = phone.digits;
    else errors.phoneNumber = phone.error;
  }

  const message = input.message.trim();
  if (message.length > WHATSAPP_MESSAGE_MAX_LENGTH) {
    errors.message = `Keep the message under ${WHATSAPP_MESSAGE_MAX_LENGTH} characters.`;
  }

  if (!(WHATSAPP_VISIBILITIES as readonly string[]).includes(input.visibility)) {
    errors.visibility = "Choose where the button appears.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      enabled: input.enabled,
      phoneNumber,
      message,
      visibility: input.visibility,
    },
  };
}

/**
 * Lenient read of a stored (possibly partial, possibly hand-edited) row:
 * merges over the defaults and drops anything of the wrong type. It does not
 * re-validate the number — `buildWhatsAppUrl` refuses a bad one instead.
 */
export function normalizeWhatsAppSettings(raw: unknown): WhatsAppSettings {
  const src =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled:
      typeof src.enabled === "boolean"
        ? src.enabled
        : DEFAULT_WHATSAPP_SETTINGS.enabled,
    phoneNumber:
      typeof src.phoneNumber === "string"
        ? src.phoneNumber
        : DEFAULT_WHATSAPP_SETTINGS.phoneNumber,
    message:
      typeof src.message === "string"
        ? src.message
        : DEFAULT_WHATSAPP_SETTINGS.message,
    visibility: (WHATSAPP_VISIBILITIES as readonly string[]).includes(
      src.visibility as string,
    )
      ? (src.visibility as WhatsAppVisibility)
      : DEFAULT_WHATSAPP_SETTINGS.visibility,
  };
}

/**
 * `https://wa.me/<digits>` plus `?text=<encoded>` when a message is set, or
 * null when the number cannot be normalised — a broken link is never built.
 */
export function buildWhatsAppUrl(
  phoneNumber: string,
  message = "",
): string | null {
  const phone = normalizeWhatsAppPhone(phoneNumber);
  if (!phone.ok) return null;
  const text = message.trim().slice(0, WHATSAPP_MESSAGE_MAX_LENGTH);
  const base = `https://wa.me/${phone.digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** What the storefront receives: only a ready link and where to show it. */
export interface PublicWhatsAppButton {
  href: string;
  visibility: WhatsAppVisibility;
}

/** Null whenever the button must not render: switched off, or no valid number. */
export function toPublicWhatsAppButton(
  settings: WhatsAppSettings,
): PublicWhatsAppButton | null {
  if (!settings.enabled) return null;
  const href = buildWhatsAppUrl(settings.phoneNumber, settings.message);
  return href ? { href, visibility: settings.visibility } : null;
}
