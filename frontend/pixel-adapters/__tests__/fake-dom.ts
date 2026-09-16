import { __resetSdkLoaderForTests } from "#root/frontend/pixel-adapters/sdk-loader";

/**
 * A throwaway window/document pair for pixel-adapter tests.
 *
 * The suite runs in Vitest's `node` environment (no jsdom in this repo), and
 * the previous adapter tests worked around that by pre-installing a mocked
 * `ttq`/`fbq` before calling `initialize()`. That made every test skip the
 * vendor bootstrap — the exact code that was broken. This harness gives each
 * test a genuinely empty window so the adapter has to install the real base
 * code, and lets the test drive script load/error outcomes by hand.
 */

export interface FakeScript {
  async: boolean;
  src: string;
  type?: string;
  listeners: Record<string, Array<() => void>>;
  addEventListener(event: string, handler: () => void): void;
  /** Simulate the browser firing `load` on this tag. */
  fireLoad(): void;
  /** Simulate the browser firing `error` on this tag (blocked, offline). */
  fireError(): void;
}

export interface FakeDom {
  window: Record<string, unknown>;
  /** Every <script> the adapters injected, in order. */
  scripts: FakeScript[];
  /** Fire `load` on every injected script that hasn't settled. */
  loadAllScripts(): void;
  /** Fire `error` on every injected script that hasn't settled. */
  failAllScripts(): void;
  restore(): void;
}

function createScript(): FakeScript {
  const script: FakeScript = {
    async: false,
    src: "",
    listeners: {},
    addEventListener(event, handler) {
      (script.listeners[event] ??= []).push(handler);
    },
    fireLoad() {
      for (const handler of script.listeners.load ?? []) handler();
    },
    fireError() {
      for (const handler of script.listeners.error ?? []) handler();
    },
  };
  return script;
}

/**
 * Install a fresh fake window/document on globalThis.
 *
 * `seed` lets a test simulate an SDK a tag manager already installed.
 */
export function installFakeDom(seed?: Record<string, unknown>): FakeDom {
  const previousWindow = (globalThis as Record<string, unknown>).window;
  const previousDocument = (globalThis as Record<string, unknown>).document;

  const scripts: FakeScript[] = [];
  const firstScript = createScript();

  const win: Record<string, unknown> = { ...seed };

  const doc = {
    cookie: "",
    referrer: "",
    createElement: (_tag: string) => createScript(),
    getElementsByTagName: (_tag: string) => [
      {
        ...firstScript,
        parentNode: {
          insertBefore: (node: FakeScript) => {
            scripts.push(node);
          },
        },
      },
    ],
    head: {
      appendChild: (node: FakeScript) => {
        scripts.push(node);
      },
    },
  };

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  __resetSdkLoaderForTests();

  return {
    window: win,
    scripts,
    loadAllScripts() {
      for (const script of scripts) script.fireLoad();
    },
    failAllScripts() {
      for (const script of scripts) script.fireError();
    },
    restore() {
      __resetSdkLoaderForTests();
      if (previousWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = previousWindow;
      }
      if (previousDocument === undefined) {
        delete (globalThis as Record<string, unknown>).document;
      } else {
        (globalThis as Record<string, unknown>).document = previousDocument;
      }
    },
  };
}
