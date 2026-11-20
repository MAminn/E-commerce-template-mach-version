import { describe, expect, it } from "vitest";
import {
  buildOrderEmailLines,
  orderEmailEligibility,
  orderEmailMessageId,
  renderOrderEmailHtml as renderRaw,
  type OrderEmailData,
} from "../service";

/** React's SSR separates adjacent text nodes with <!-- --> markers; drop them for text assertions. */
const renderOrderEmailHtml = async (...args: Parameters<typeof renderRaw>) => {
  const out = await renderRaw(...args);
  return { ...out, html: out.html.replace(/<!-- -->/g, "") };
};
import type { EmailBranding } from "#root/backend/emails/branding";

const branding: EmailBranding = {
  storeName: "Mach Supplements",
  logoUrl: undefined,
  contactEmail: undefined,
  currency: "EGP",
  isMinimal: false, // MACH's real value: navbarStyle "editorial", not "minimal"
  socialLinks: [],
  supportEmail: "support@machsupplements.com",
  websiteUrl: "https://machsupplements.com",
};

function data(overrides: Partial<OrderEmailData["order"]> = {}): OrderEmailData {
  const id = "019a0000-0000-7000-8000-00000000abcd";
  return {
    order: {
      id,
      reference: "ORD-1F28C215",
      customerName: "Omar Test",
      customerEmail: "omar@example.com",
      customerPhone: "01000000000",
      shippingAddress: "12 Abbas El Akkad St",
      shippingCity: "Nasr City",
      shippingState: "Cairo",
      shippingPostalCode: "11765",
      shippingCountry: "Egypt",
      subtotal: "2950.00",
      discount: "295.00",
      shipping: "85.00",
      tax: "0",
      total: "2740.00",
      paymentMethod: "cod",
      paymentStatus: "not_required",
      status: "pending",
      fulfillmentHold: null,
      fulfillmentHoldNote: null,
      createdAt: new Date("2026-11-20T10:00:00Z"),
      ...overrides,
    } as OrderEmailData["order"],
    items: [
      { id: "i1", name: "Mach Whey Isolate 2lb", quantity: 2, price: "1400.00", discountPrice: "1250.00", isFreeGift: false },
      { id: "i2", name: "Mach Creatine 300g", quantity: 1, price: "450.00", discountPrice: null, isFreeGift: false },
      { id: "i3", name: "Mach Shaker", quantity: 1, price: "0.00", discountPrice: null, isFreeGift: true },
    ] as OrderEmailData["items"],
    promoCode: "MACH10",
  };
}

describe("order email rendering (MACH)", () => {
  it("renders the store's own branding, the order number and every order fact — never Lebsy/Percé", async () => {
    const { subject, html } = await renderOrderEmailHtml(data(), branding, "customer");
    expect(subject).toBe("Mach Supplements — Order Confirmation #1F28C215");
    expect(html).toContain("Mach Supplements");
    expect(html).toContain("#1F28C215");
    expect(html).toContain("20 Nov 2026");
    expect(html).toContain("Cash on delivery");
    expect(html).toContain("Omar Test");
    expect(html).toContain("Mach Whey Isolate 2lb");
    expect(html).toContain("2500.00 EGP"); // 2 × 1250 (discounted unit)
    expect(html).toContain("2800.00 EGP"); // struck-through list total 2 × 1400
    expect(html).toContain("1250.00 EGP each");
    expect(html).toContain("Mach Creatine 300g");
    expect(html).toContain("Discount (MACH10)");
    expect(html).toContain("295.00 EGP");
    expect(html).toContain("85.00 EGP");
    expect(html).toContain("2740.00 EGP");
    expect(html).toContain("12 Abbas El Akkad St");
    expect(html).toContain("Nasr City, Cairo, 11765");
    expect(html).toContain("support@machsupplements.com");
    expect(html).toContain("machsupplements.com");
    expect(html).not.toMatch(/lebsy|perc[eé]|piercing/i);
  });

  it("prints a BOGO gift line as Free, not as a 0.00 price", async () => {
    const { html } = await renderOrderEmailHtml(data(), branding, "customer");
    expect(html).toMatch(/Mach Shaker[\s\S]*Gift[\s\S]*Free/);
    const lines = buildOrderEmailLines(data().items);
    expect(lines[2]).toMatchObject({ isFreeGift: true, unitPrice: 0, lineTotal: 0 });
    expect(lines[0]).toMatchObject({ unitPrice: 1250, listUnitPrice: 1400, lineTotal: 2500 });
  });

  it("shows free shipping as Free and omits a zero discount", async () => {
    const { html } = await renderOrderEmailHtml(data({ shipping: "0.00", discount: null }), branding, "customer");
    expect(html).not.toContain("Discount");
    expect(html).toMatch(/Shipping[\s\S]{0,400}Free/);
  });

  it("a paid order on a stock hold gets the truthful under-review copy (customer) and the red hold notice (admin)", async () => {
    const held = data({ paymentMethod: "fawaterak", paymentStatus: "paid", fulfillmentHold: "stock_conflict", fulfillmentHoldNote: "requested 2, available 1" });
    const customer = await renderOrderEmailHtml(held, branding, "customer");
    expect(customer.subject).toBe("Mach Supplements — Payment received, order #1F28C215 under review");
    expect(customer.html).toContain("Your order is currently under review.");
    expect(customer.html).toContain("Paid online");
    const admin = await renderOrderEmailHtml(held, branding, "admin");
    expect(admin.subject).toMatch(/^PAID ORDER ON HOLD #1F28C215/);
    expect(admin.html).toContain("DO NOT PREPARE");
  });

  it("the store notification names the order and total", async () => {
    const { subject, html } = await renderOrderEmailHtml(data(), branding, "admin");
    expect(subject).toBe("New order #1F28C215 — 2740.00 EGP");
    expect(html).toContain("A new order was placed on Mach Supplements.");
  });

  it("without a support address the footer still offers a way to reply", async () => {
    const { html } = await renderOrderEmailHtml(data(), { ...branding, supportEmail: undefined }, "customer");
    expect(html).toContain("Just reply to this email");
  });
});

describe("order email lifecycle rule", () => {
  it("COD is confirmable when placed; online only once paid", () => {
    expect(orderEmailEligibility({ paymentMethod: "cod", paymentStatus: "not_required" }).eligible).toBe(true);
    expect(orderEmailEligibility({ paymentMethod: "fawaterak", paymentStatus: "paid" }).eligible).toBe(true);
    for (const status of ["pending", "failed", "processing", null]) {
      expect(orderEmailEligibility({ paymentMethod: "paymob", paymentStatus: status }).eligible).toBe(false);
    }
  });
});

describe("stable Message-IDs", () => {
  it("are per order for the customer and per order+recipient for the store, on the From domain", () => {
    process.env.EMAIL_FROM_ADDRESS = "orders@machsupplements.com";
    const c = orderEmailMessageId({ automationType: "order_confirmation", recipientEmail: "a@x.com" }, "ID1");
    expect(c).toBe("<order-confirmation.ID1@machsupplements.com>");
    const a1 = orderEmailMessageId({ automationType: "order_admin_notification", recipientEmail: "admin1@x.com" }, "ID1");
    const a2 = orderEmailMessageId({ automationType: "order_admin_notification", recipientEmail: "ADMIN1@x.com" }, "ID1");
    const b = orderEmailMessageId({ automationType: "order_admin_notification", recipientEmail: "admin2@x.com" }, "ID1");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toContain("admin1"); // recipient is hashed, not exposed
  });
});
