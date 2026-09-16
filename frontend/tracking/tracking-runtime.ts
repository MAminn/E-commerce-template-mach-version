import type {
  ConsentState,
  PixelConfig,
  TrackingEvent,
} from "#root/shared/types/pixel-tracking";
import { TrackingEventName } from "#root/shared/types/pixel-tracking";
import { PixelAdapterRegistry } from "#root/frontend/pixel-adapters/registry";
import { createAdapterForPlatform } from "#root/frontend/pixel-adapters/factory";
import type {
  PixelAdapter,
  PixelAdapterStatus,
} from "#root/frontend/pixel-adapters/types";
// One shared decision function, used identically by the beacon endpoint.
import { isConfigAllowedByConsent } from "#root/shared/utils/consent-gate";

export { isConfigAllowedByConsent };

/**
 * Browser-side tracking orchestration, with no React in it.
 *
 * Client pixel configurations arrive over the network, so for the first few
 * hundred milliseconds of a page there are no adapters yet. Anything a
 * component emitted in that window used to reach `/api/track` but never the
 * browser pixels, which shows up as server-only conversions that Meta and
 * TikTok cannot deduplicate or attribute. This runtime holds those events in a
 * bounded queue and replays them — with their original event ids — as soon as
 * adapters exist.
 *
 * Everything here is about *dispatch*. "Dispatched" means the vendor SDK
 * accepted the call; only the platform's Test Events view can confirm receipt.
 */

export type TrackingRuntimePhase =
  | "idle"
  | "loading-config"
  | "ready"
  | "config-failed";

export interface TrackingRuntimeDiagnostics {
  phase: TrackingRuntimePhase;
  /** Configs returned by the server that this runtime kept (client-side on). */
  activeConfigCount: number;
  /** Events replayed out of the pre-initialization queue. */
  replayedEventCount: number;
  /** Events dropped because the queue was full. Should normally be 0. */
  droppedEventCount: number;
  /** Configs held back because their consent category isn't granted. */
  consentBlockedConfigIds: string[];
  configError?: string;
  adapters: PixelAdapterStatus[];
}

export interface TrackingRuntimeOptions {
  /** Fetches the enabled client-side pixel configurations. */
  loadConfigs: () => Promise<PixelConfig[]>;
  /** Overridable for tests. */
  createAdapter?: (platform: PixelConfig["platform"]) => PixelAdapter | undefined;
  /** Max events held before adapters exist. Oldest are dropped past this. */
  maxQueuedEvents?: number;
  /** Reports config-load failures somewhere visible. */
  onError?: (message: string, error: unknown) => void;
}

const DEFAULT_MAX_QUEUED_EVENTS = 50;

export class TrackingRuntime {
  private readonly registry = new PixelAdapterRegistry();
  private readonly options: TrackingRuntimeOptions;
  private readonly createAdapter: NonNullable<
    TrackingRuntimeOptions["createAdapter"]
  >;
  private readonly maxQueuedEvents: number;

  private phase: TrackingRuntimePhase = "idle";
  private configs: PixelConfig[] = [];
  private pendingEvents: TrackingEvent[] = [];
  private replayedEventCount = 0;
  private droppedEventCount = 0;
  private configError?: string;
  private consent: ConsentState | null = null;
  private destroyed = false;
  /** Guards against two initialize()/refresh() passes interleaving. */
  private inFlight: Promise<void> | null = null;

  constructor(options: TrackingRuntimeOptions) {
    this.options = options;
    this.createAdapter = options.createAdapter ?? createAdapterForPlatform;
    this.maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
  }

  /** Current consent decision; `null` until the banner state is known. */
  setConsent(consent: ConsentState | null): void {
    this.consent = consent;
    if (this.phase === "ready") this.applyConfigs(this.configs);
  }

  /**
   * Load configurations and bring adapters up. Safe to call more than once —
   * a second call reconciles against what is already running rather than
   * re-initializing everything.
   */
  async initialize(): Promise<void> {
    if (this.destroyed) return;
    if (this.inFlight) return this.inFlight;

    this.phase = this.phase === "ready" ? this.phase : "loading-config";

    this.inFlight = (async () => {
      try {
        const configs = await this.options.loadConfigs();
        if (this.destroyed) return;
        this.configError = undefined;
        this.configs = configs;
        this.applyConfigs(configs);
        this.phase = "ready";
      } catch (err) {
        if (this.destroyed) return;
        // A failed config load means no browser pixels fire at all, which is
        // exactly the failure that is hardest to notice in production. Surface
        // it instead of swallowing it.
        this.phase = "config-failed";
        this.configError =
          err instanceof Error ? err.message : "Failed to load pixel configs";
        this.options.onError?.(
          "[Tracking] Failed to load pixel configurations",
          err,
        );
      } finally {
        this.inFlight = null;
        // Queued events are released either way: on failure they are dropped
        // from the queue rather than held forever, and they have already been
        // sent to /api/track by the caller.
        this.flushPendingEvents();
      }
    })();

    return this.inFlight;
  }

  /**
   * Re-read configurations after an admin change. Adapters for unchanged
   * configs are left running (no duplicate init events); removed ones are
   * destroyed and new ones started.
   */
  async refresh(): Promise<void> {
    if (this.destroyed) return;
    await this.initialize();
  }

  /**
   * Handle one tracking event. Before adapters exist it is queued with its
   * original event id so browser/server deduplication still works on replay.
   */
  handleEvent(event: TrackingEvent): void {
    if (this.destroyed) return;

    if (this.phase === "idle" || this.phase === "loading-config") {
      this.enqueue(event);
      return;
    }

    this.registry.broadcastEvent(event);
  }

  /** Send an event to exactly one configuration (admin browser test). */
  dispatchToConfig(configId: string, event: TrackingEvent): boolean {
    if (this.destroyed) return false;
    return this.registry.dispatchToConfig(configId, event);
  }

  getRegistry(): PixelAdapterRegistry {
    return this.registry;
  }

  getDiagnostics(): TrackingRuntimeDiagnostics {
    const blocked = this.configs
      .filter(
        (config) =>
          config.enabled &&
          config.enableClientSide &&
          !isConfigAllowedByConsent(config, this.consent),
      )
      .map((config) => config.id);

    return {
      phase: this.phase,
      activeConfigCount: this.registry.size,
      replayedEventCount: this.replayedEventCount,
      droppedEventCount: this.droppedEventCount,
      consentBlockedConfigIds: blocked,
      ...(this.configError ? { configError: this.configError } : {}),
      adapters: this.registry.getStatuses(),
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingEvents = [];
    this.registry.destroyAll();
    this.phase = "idle";
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private enqueue(event: TrackingEvent): void {
    if (this.pendingEvents.length >= this.maxQueuedEvents) {
      // Bounded: a page that never finishes loading configs must not grow the
      // queue without limit. Drop the oldest and count it.
      this.pendingEvents.shift();
      this.droppedEventCount += 1;
    }
    this.pendingEvents.push(event);
  }

  private flushPendingEvents(): void {
    if (this.pendingEvents.length === 0) return;
    const queued = this.pendingEvents;
    this.pendingEvents = [];

    if (this.phase !== "ready" || this.registry.size === 0) {
      // No adapters to replay into. The events already went to /api/track.
      return;
    }

    for (const event of queued) {
      this.replayedEventCount += 1;
      this.registry.broadcastEvent(event);
    }
  }

  /**
   * Reconcile running adapters against the configuration list.
   *
   * Adapters are keyed by config id, so an existing one is re-initialized
   * (idempotent inside the adapter) rather than replaced. Configs that were
   * deleted, disabled, or had client-side turned off are destroyed.
   */
  private applyConfigs(configs: PixelConfig[]): void {
    const wanted = new Map<string, PixelConfig>();

    for (const config of configs) {
      if (!config.enabled || !config.enableClientSide) continue;
      if (!isConfigAllowedByConsent(config, this.consent)) continue;
      wanted.set(config.id, config);
    }

    for (const adapter of this.registry.getAllAdapters()) {
      const configId = adapter.configId;
      if (!configId || wanted.has(configId)) continue;
      this.registry.unregisterConfig(configId);
    }

    for (const [configId, config] of wanted) {
      const existing = this.registry.getAdapterByConfigId(configId);
      if (existing) {
        // Idempotent in the adapter: same pixel id → refresh flags only.
        existing.initialize(config);
        continue;
      }
      const adapter = this.createAdapter(config.platform);
      if (!adapter) continue;
      // Adapters that don't track their own config id still have to be keyed
      // by one, or a refresh would build a second adapter for the same pixel
      // and re-run its initialization.
      (adapter as { configId?: string }).configId = configId;
      adapter.initialize(config);
      this.registry.register(adapter);
    }
  }
}

/** The canonical page-view event name, re-exported for callers. */
export const PAGE_VIEW_EVENT = TrackingEventName.PAGE_VIEWED;
