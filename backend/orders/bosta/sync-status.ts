import { db, type DatabaseClient } from "#root/shared/database/drizzle/db";
import { order } from "#root/shared/database/drizzle/schema";
import { eq } from "drizzle-orm";
import type { BostaDeliveryResult } from "./service";
import { getBostaStateName } from "./states";

/** Persisted on the order row for dashboard debugging */
export type BostaSyncStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled";

/** Bosta state code written locally when we terminate a delivery ourselves. */
export const BOSTA_TERMINATED_STATE_CODE = 48;

export async function persistBostaSyncStatus(
  orderId: string,
  status: BostaSyncStatus,
  opts?: {
    error?: string | null;
    delivery?: BostaDeliveryResult;
    /** Use an existing client (e.g. inside a request) instead of opening one. */
    client?: DatabaseClient;
  },
): Promise<void> {
  const now = new Date();
  const base: Record<string, unknown> = {
    bostaSyncStatus: status,
    bostaSyncAttemptedAt: now,
    updatedAt: now,
  };

  if (status === "sent" && opts?.delivery) {
    Object.assign(base, {
      bostaSyncError: null,
      bostaSyncedAt: now,
      bostaDeliveryId: opts.delivery.deliveryId,
      bostaTrackingNumber: opts.delivery.trackingNumber,
      bostaStatus: opts.delivery.stateValue,
      bostaStatusCode: String(opts.delivery.stateCode),
      bostaStatusUpdatedAt: now,
    });
  } else if (status === "failed") {
    Object.assign(base, {
      bostaSyncError: opts?.error ?? "Unknown error",
    });
  } else if (status === "skipped") {
    Object.assign(base, {
      bostaSyncError: opts?.error ?? null,
    });
  } else if (status === "cancelled") {
    Object.assign(base, {
      bostaSyncError: null,
      bostaStatus: getBostaStateName(BOSTA_TERMINATED_STATE_CODE),
      bostaStatusCode: String(BOSTA_TERMINATED_STATE_CODE),
      bostaStatusUpdatedAt: now,
    });
  } else if (status === "pending") {
    Object.assign(base, {
      bostaSyncError: null,
    });
  }

  await (opts?.client ?? db())
    .update(order)
    .set(base)
    .where(eq(order.id, orderId))
    .execute();
}
