import type {
  PixelPlatform,
  TrackingEvent,
} from "#root/shared/types/pixel-tracking";
import type { PixelAdapter, PixelAdapterStatus } from "./types";

// ─── Pixel Adapter Registry ─────────────────────────────────────────────────
// Holds all active adapters and fans out events to each of them.
//
// Adapters are keyed by their `pixel_config` row id when they have one, so a
// merchant can run two pixels of the same platform (a legacy Meta pixel and a
// new one, say) without the second silently replacing the first. Adapters
// without a configId still key by platform, which keeps the old behaviour.

export class PixelAdapterRegistry {
  private adapters: Map<string, PixelAdapter> = new Map();

  private static keyFor(adapter: PixelAdapter): string {
    return adapter.configId ?? adapter.platform;
  }

  /** Whether an adapter may receive events right now. */
  private static isDispatchable(adapter: PixelAdapter): boolean {
    if (!adapter.isEnabled()) return false;
    // Adapters that distinguish "queued" from "loaded" answer for themselves;
    // the rest keep the original isLoaded() gate.
    return adapter.canAcceptEvents
      ? adapter.canAcceptEvents()
      : adapter.isLoaded();
  }

  /** Register an adapter. Replaces any existing adapter with the same key. */
  register(adapter: PixelAdapter): void {
    this.adapters.set(PixelAdapterRegistry.keyFor(adapter), adapter);
  }

  /** Remove an adapter by platform. Calls `destroy()` before removing. */
  unregister(platform: PixelPlatform): void {
    for (const [key, adapter] of this.adapters) {
      if (adapter.platform !== platform) continue;
      adapter.destroy();
      this.adapters.delete(key);
    }
  }

  /** Remove one adapter by its pixel config id. Calls `destroy()` first. */
  unregisterConfig(configId: string): void {
    const adapter = this.adapters.get(configId);
    if (!adapter) return;
    adapter.destroy();
    this.adapters.delete(configId);
  }

  /** Get the first registered adapter for a platform. */
  getAdapter(platform: PixelPlatform): PixelAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.platform === platform) return adapter;
    }
    return undefined;
  }

  /** Get one adapter by its pixel config id. */
  getAdapterByConfigId(configId: string): PixelAdapter | undefined {
    return this.adapters.get(configId);
  }

  /** Get all registered adapters. */
  getAllAdapters(): PixelAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** Number of registered adapters. */
  get size(): number {
    return this.adapters.size;
  }

  /** Fan-out: send an event to every adapter currently able to accept one. */
  broadcastEvent(event: TrackingEvent): void {
    for (const adapter of this.adapters.values()) {
      if (!PixelAdapterRegistry.isDispatchable(adapter)) continue;
      try {
        adapter.trackEvent(event);
      } catch {
        // Adapter errors must never break the event pipeline.
        console.warn(
          `[PixelAdapterRegistry] Error broadcasting to ${adapter.platform}`,
        );
      }
    }
  }

  /**
   * Send an event to exactly one configuration. Returns whether the adapter
   * accepted the call — which means "handed to the vendor SDK", never
   * "received by the platform".
   */
  dispatchToConfig(configId: string, event: TrackingEvent): boolean {
    const adapter = this.adapters.get(configId);
    if (!adapter) return false;
    if (!PixelAdapterRegistry.isDispatchable(adapter)) return false;
    try {
      adapter.trackEvent(event);
      return true;
    } catch {
      console.warn(
        `[PixelAdapterRegistry] Error dispatching to ${adapter.platform}`,
      );
      return false;
    }
  }

  /** Lifecycle snapshot of every adapter, for admin diagnostics. */
  getStatuses(): PixelAdapterStatus[] {
    return this.getAllAdapters().map(
      (adapter) =>
        adapter.getStatus?.() ?? {
          platform: adapter.platform,
          configId: adapter.configId,
          pixelId: "",
          state: adapter.isLoaded() ? "loaded" : "queued",
        },
    );
  }

  /** Destroy all adapters and clear the registry. */
  destroyAll(): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.destroy();
      } catch {
        // Best-effort cleanup
      }
    }
    this.adapters.clear();
  }
}
