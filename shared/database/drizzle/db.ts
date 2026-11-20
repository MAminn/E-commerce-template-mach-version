import { ServerError } from "#root/shared/error/server.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, pipe } from "effect";
import * as schema from "./schema.js";

export function db() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error("[DB Connection] ERROR: DATABASE_URL is not set");
    throw new Error("DATABASE_URL is not set");
  }

  const sanitizedUrl = dbUrl.replace(
    /(postgres:\/\/[^:]+):([^@]+)@/,
    "postgres://$1:***@",
  );

  try {
    const connection = drizzle(dbUrl, {
      schema,
    });
    return connection;
  } catch (error) {
    console.error(
      "[DB Connection] Failed to create database connection:",
      error,
    );
    throw error;
  }
}

let sharedClient: ReturnType<typeof db> | null = null;
let sharedClientUrl: string | undefined;

/**
 * One pooled client per process (per DATABASE_URL), for hot background
 * paths — the email outbox worker and the order activity log. `db()` builds
 * a brand-new pg Pool on every call, so a path that calls it several times
 * per email holds several idle connections each time.
 */
export function sharedDb(): ReturnType<typeof db> {
  const url = process.env.DATABASE_URL;
  if (!sharedClient || sharedClientUrl !== url) {
    sharedClient = db();
    sharedClientUrl = url;
    // An idle pooled connection dropped by the server emits "error" on the
    // pool; unhandled, that would crash the process.
    (sharedClient as unknown as { $client?: { on?: (e: string, cb: (err: unknown) => void) => void } }).$client?.on?.(
      "error",
      (err) => console.error("[DB] Idle shared pool connection error:", err instanceof Error ? err.message : err),
    );
  }
  return sharedClient;
}

export class DatabaseClientService extends Context.Tag("DatabaseClientService")<
  DatabaseClientService,
  DatabaseClient
>() {}

export type DatabaseClient = ReturnType<typeof db>;

export const query = <A>(fn: (db: DatabaseClient) => Promise<A>) =>
  pipe(
    DatabaseClientService,
    Effect.flatMap((db) =>
      Effect.tryPromise({
        try: async () => await fn(db),
        catch: (err) => {
          // If it's already a ServerError, pass it through without re-wrapping
          if (err instanceof ServerError) {
            return err;
          }
          console.error("[Database Query Error]", err);
          return new ServerError({
            tag: "DatabaseQueryError",
            cause: err,
          });
        },
      }),
    ),
  );
