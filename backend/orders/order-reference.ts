import { v7 } from "uuid";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import { orderReference } from "#root/shared/database/drizzle/schema";
import { buildOrderReference } from "#root/shared/orders/order-reference";

/** Anything that can run an insert — the db client or a transaction. */
type InsertClient = Pick<DatabaseClient, "insert">;

const MAX_DRAWS = 10;

/**
 * Draw an id whose reference is not yet taken and register it, atomically
 * (INSERT … ON CONFLICT DO NOTHING on the registry's primary key — never an
 * error, so it is safe inside a caller's transaction). Run it in the same
 * transaction as the row that uses the id so a rollback frees the reference.
 */
export async function claimOrderReference(
  db: InsertClient,
  kind: "order" | "attempt",
  newId: () => string = v7,
): Promise<{ id: string; reference: string }> {
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    const id = newId();
    const reference = buildOrderReference(id);
    const claimed = await db
      .insert(orderReference)
      .values({ reference, kind, ownerId: id })
      .onConflictDoNothing({ target: orderReference.reference })
      .returning({ reference: orderReference.reference })
      .execute();
    if (claimed.length > 0) return { id, reference };
  }
  // 10 consecutive collisions on 32 random bits is not a real-world event.
  throw new Error("Could not allocate a unique order reference");
}
