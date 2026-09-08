import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCartSessionToken } from "#root/lib/cart-session";

const SESSION_TOKEN_KEY = "cart-session-token";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Globals = Record<string, unknown>;

function makeLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    store,
  };
}

describe("getCartSessionToken", () => {
  const globals = globalThis as unknown as Globals;
  const originalWindow = globals.window;
  const originalLocalStorage = globals.localStorage;
  const realCrypto = globalThis.crypto;

  beforeEach(() => {
    globals.window = globalThis;
  });

  afterEach(() => {
    globals.window = originalWindow;
    globals.localStorage = originalLocalStorage;
    vi.stubGlobal("crypto", realCrypto);
    vi.unstubAllGlobals();
  });

  it("returns an existing localStorage token unchanged", () => {
    const existing = "11111111-2222-4333-8444-555555555555";
    const storage = makeLocalStorage({ [SESSION_TOKEN_KEY]: existing });
    globals.localStorage = storage;

    expect(getCartSessionToken()).toBe(existing);
    expect(storage.store.get(SESSION_TOKEN_KEY)).toBe(existing);
  });

  it("uses native crypto.randomUUID() when available", () => {
    const storage = makeLocalStorage();
    globals.localStorage = storage;
    const randomUUID = vi.fn(() => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    vi.stubGlobal("crypto", { ...realCrypto, randomUUID });

    const token = getCartSessionToken();

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(token).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(storage.store.get(SESSION_TOKEN_KEY)).toBe(token);
    // Second call reuses the persisted token instead of regenerating.
    expect(getCartSessionToken()).toBe(token);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("falls back to getRandomValues() when randomUUID is unavailable", () => {
    const storage = makeLocalStorage();
    globals.localStorage = storage;
    const getRandomValues = vi.fn((array: Uint8Array) =>
      realCrypto.getRandomValues(array),
    );
    // Plain-HTTP browsers expose getRandomValues but not randomUUID.
    vi.stubGlobal("crypto", { getRandomValues });

    const token = getCartSessionToken();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(token).toMatch(UUID_V4);
    expect(storage.store.get(SESSION_TOKEN_KEY)).toBe(token);
    expect(getCartSessionToken()).toBe(token);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("returns an empty string outside the browser", () => {
    globals.window = undefined;
    expect(getCartSessionToken()).toBe("");
  });
});
