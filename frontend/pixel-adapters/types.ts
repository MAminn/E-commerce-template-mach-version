import type {
  PixelPlatform,
  PixelConfig,
  TrackingEvent,
} from "#root/shared/types/pixel-tracking";

// ─── Adapter Lifecycle State ────────────────────────────────────────────────
// Loading a vendor SDK and having a platform *accept* an event are two very
// different things. The state below only ever describes the first one:
//
//   idle    — initialize() has not run (or destroy() has run)
//   queued  — the vendor stub exists and is accepting calls into its queue,
//             but the real SDK script has not confirmed it loaded yet
//   loaded  — the SDK script fired `load`; queued calls have been drained
//   failed  — the SDK script fired `error` (blocked, offline, ad-blocker…)
//
// Nothing here implies the platform received, accepted, or will report an
// event. That can only be confirmed in the platform's own Test Events tool.

export type PixelAdapterState = "idle" | "queued" | "loaded" | "failed";

export interface PixelAdapterStatus {
  platform: PixelPlatform;
  /** The `pixel_config` row this adapter instance was initialized from. */
  configId?: string;
  pixelId: string;
  state: PixelAdapterState;
  /** Set when `state === "failed"`. Never contains tokens or user data. */
  error?: string;
}

// ─── Pixel Adapter Interface ────────────────────────────────────────────────
// Every platform adapter must implement this interface.
// Adding a new platform = implement this + register it.

export interface PixelAdapter {
  /** Which platform this adapter handles */
  readonly platform: PixelPlatform;

  /**
   * The `pixel_config` row id this adapter was initialized from.
   * Set by adapters that support per-configuration dispatch so the registry
   * can hold several pixels of the same platform without them colliding.
   */
  readonly configId?: string;

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Load the platform's JS SDK and initialize with the given config */
  initialize(config: PixelConfig): void;

  /** Clean up: remove injected scripts, detach globals */
  destroy(): void;

  // ── Event Tracking ──────────────────────────────────────────────────────

  /** Translate our canonical event into a platform-specific call */
  trackEvent(event: TrackingEvent): void;

  // ── Status ──────────────────────────────────────────────────────────────

  /** Whether the platform SDK script has confirmed it finished loading */
  isLoaded(): boolean;

  /** Whether the adapter is currently active and should receive events */
  isEnabled(): boolean;

  /**
   * Whether calls made now will reach the platform — true while the vendor
   * queue is accepting calls (`queued`) as well as after the script loaded.
   * Adapters that don't implement it fall back to `isLoaded()`.
   */
  canAcceptEvents?(): boolean;

  /** Detailed lifecycle state, for the admin diagnostics view. */
  getStatus?(): PixelAdapterStatus;
}
