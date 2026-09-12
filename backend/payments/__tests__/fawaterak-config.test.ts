import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FAWATERAK_DEFAULT_BASE_URL,
  getActiveGateways,
  getAvailablePaymentMethods,
  getFawaterakConfig,
  getPaymentMethodOptions,
  hasOnlinePayment,
  isFawaterakConfigured,
  isOnlinePaymentMethod,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHODS,
} from "#root/shared/config/payment";
import {
  clearFawaterakEnv,
  clearOtherGatewayEnv,
  setFawaterakEnv,
  TEST_ENV,
} from "./fawaterak-test-utils";

beforeEach(() => {
  clearOtherGatewayEnv();
  clearFawaterakEnv();
});
afterEach(() => {
  clearOtherGatewayEnv();
  clearFawaterakEnv();
});

describe("Fawaterak configuration detection", () => {
  it("1. Fawaterak is absent when no credentials are configured (COD only)", () => {
    expect(isFawaterakConfigured()).toBe(false);
    expect(getActiveGateways()).toEqual([]);
    expect(getAvailablePaymentMethods()).toEqual(["cod"]);
    expect(hasOnlinePayment()).toBe(false);
  });

  it("1b. a partial configuration is treated as NOT configured", () => {
    setFawaterakEnv({ FAWATERAK_VENDOR_API_KEY: undefined });
    expect(isFawaterakConfigured()).toBe(false);
    setFawaterakEnv({ FAWATERAK_CLIENT_SECRET: "   " });
    expect(isFawaterakConfigured()).toBe(false);
    setFawaterakEnv({ FAWATERAK_CLIENT_ID: undefined });
    expect(isFawaterakConfigured()).toBe(false);
    expect(getAvailablePaymentMethods()).toEqual(["cod"]);
  });

  it("2. becomes available with CLIENT_ID + CLIENT_SECRET + VENDOR_API_KEY", () => {
    setFawaterakEnv();
    expect(isFawaterakConfigured()).toBe(true);
    expect(getActiveGateways()).toEqual(["fawaterak"]);
    expect(getAvailablePaymentMethods()).toEqual(["cod", "fawaterak"]);
    expect(hasOnlinePayment()).toBe(true);
  });

  it("reads config server-side with base URL defaulting to production", () => {
    setFawaterakEnv({ FAWATERAK_BASE_URL: undefined });
    expect(getFawaterakConfig()).toEqual({
      clientId: TEST_ENV.FAWATERAK_CLIENT_ID,
      clientSecret: TEST_ENV.FAWATERAK_CLIENT_SECRET,
      vendorApiKey: TEST_ENV.FAWATERAK_VENDOR_API_KEY,
      baseUrl: FAWATERAK_DEFAULT_BASE_URL,
    });
    expect(FAWATERAK_DEFAULT_BASE_URL).toBe("https://app.fawaterk.com");

    setFawaterakEnv({ FAWATERAK_BASE_URL: "https://staging.fawaterk.com/" });
    expect(getFawaterakConfig().baseUrl).toBe("https://staging.fawaterk.com");
  });

  it("3. customer-facing options carry labels only — no secrets, ids, or URLs", () => {
    setFawaterakEnv();
    const options = getPaymentMethodOptions();
    const serialized = JSON.stringify(options);
    for (const secret of [
      TEST_ENV.FAWATERAK_CLIENT_ID,
      TEST_ENV.FAWATERAK_CLIENT_SECRET,
      TEST_ENV.FAWATERAK_VENDOR_API_KEY,
      TEST_ENV.FAWATERAK_BASE_URL,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual(["description", "id", "label"]);
    }
  });

  it("no VITE_ variable is involved in Fawaterak configuration", () => {
    const viteKeys = Object.keys(process.env).filter(
      (k) => k.startsWith("VITE_") && /FAWATER/i.test(k),
    );
    expect(viteKeys).toEqual([]);
  });
});

describe("payment method labels", () => {
  it("Fawaterak alone presents as plain 'Online Payment'", () => {
    setFawaterakEnv();
    expect(getPaymentMethodOptions()).toEqual([
      { id: "cod", label: "Cash on Delivery", description: expect.any(String) },
      { id: "fawaterak", label: "Online Payment", description: expect.any(String) },
    ]);
  });

  it("Paymob alone keeps its existing plain 'Online Payment' wording", () => {
    expect(getPaymentMethodOptions(["cod", "paymob"]).map((o) => o.label)).toEqual([
      "Cash on Delivery",
      "Online Payment",
    ]);
  });

  it("24. Paymob + Fawaterak together are disambiguated", () => {
    const labels = getPaymentMethodOptions(["cod", "paymob", "fawaterak"]).map((o) => o.label);
    expect(labels).toEqual([
      "Cash on Delivery",
      "Online Payment (Paymob)",
      "Online Payment (Fawaterak)",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("Stripe wording is untouched", () => {
    expect(getPaymentMethodOptions(["cod", "stripe", "fawaterak"]).map((o) => o.label)).toEqual([
      "Cash on Delivery",
      "Credit / Debit Card",
      "Online Payment",
    ]);
  });
});

describe("shared online-method helpers", () => {
  it("centralize the union used by zod enums and DB checks", () => {
    expect([...ONLINE_PAYMENT_METHODS]).toEqual(["stripe", "paymob", "fawaterak"]);
    expect([...PAYMENT_METHODS]).toEqual(["cod", "stripe", "paymob", "fawaterak"]);
    expect(isOnlinePaymentMethod("fawaterak")).toBe(true);
    expect(isOnlinePaymentMethod("paymob")).toBe(true);
    expect(isOnlinePaymentMethod("stripe")).toBe(true);
    expect(isOnlinePaymentMethod("cod")).toBe(false);
    expect(isOnlinePaymentMethod(null)).toBe(false);
    expect(isOnlinePaymentMethod(undefined)).toBe(false);
    expect(isOnlinePaymentMethod("FAWATERAK")).toBe(false);
  });
});
