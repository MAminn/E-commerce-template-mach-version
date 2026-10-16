import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PassThrough } from "node:stream";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  ORDERS_EXPORT_COUNT_HEADER,
  ORDERS_EXPORT_ENDPOINT,
} from "#root/shared/orders/order-export";
import { exportFileName } from "./csv";
import { ExportAbortedError, exportOrdersQuerySchema, streamOrdersCsv } from "./service";

/**
 * GET /api/dashboard/orders/export — the Orders dashboard as a CSV download.
 *
 * A plain route rather than tRPC so the file streams straight to the browser
 * instead of being built as one JSON payload. Admins only, read-only, and
 * the same filters as the dashboard list (see ./service.ts).
 */

function refuse(reply: FastifyReply, statusCode: number, error: string) {
  return reply.code(statusCode).send({ success: false as const, error });
}

function isAdmin(request: FastifyRequest): boolean {
  const role = request.clientSession?.role;
  return role === "admin" || role === "superadmin";
}

export interface OrdersExportApiOptions {
  /** Defaults to the request's database; tests pass their own. */
  getDb?: (request: FastifyRequest) => DatabaseClient;
}

export const ordersExportApiPlugin = async (
  app: FastifyInstance,
  { getDb = (request) => request.db }: OrdersExportApiOptions = {},
) => {
  app.get(ORDERS_EXPORT_ENDPOINT, async (request, reply) => {
    if (!request.clientSession) {
      return refuse(reply, 401, "Please sign in again to export orders.");
    }
    if (!isAdmin(request)) {
      return refuse(reply, 403, "Unauthorized. Only admins can export orders.");
    }

    const parsed = exportOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return refuse(reply, 400, "Invalid export filters.");
    }

    const out = new PassThrough();
    // Failures are logged below; until Fastify takes the stream, an 'error'
    // with no listener would crash the process.
    out.on("error", () => {});
    let onCount!: (count: number) => void;
    let onFailure!: (error: unknown) => void;
    const counted = new Promise<number>((resolve, reject) => {
      onCount = resolve;
      onFailure = reject;
    });

    Promise.resolve()
      .then(() => streamOrdersCsv(getDb(request), parsed.data, out, onCount))
      .then(
        () => out.end(),
        (error) => {
          onFailure(error);
          if (!(error instanceof ExportAbortedError)) {
            request.log.error({ err: error }, "Orders CSV export failed");
          }
          // Mid-stream this aborts the download, so the browser never saves a
          // truncated file as if it were complete.
          out.destroy(error instanceof Error ? error : new Error(String(error)));
        },
      );
    // Client went away: stop reading the database.
    reply.raw.on("close", () => {
      if (!out.writableEnded) out.destroy();
    });

    let count: number;
    try {
      count = await counted;
    } catch {
      return refuse(reply, 500, "Could not export orders. Please try again.");
    }

    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${exportFileName(new Date())}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(ORDERS_EXPORT_COUNT_HEADER, String(count))
      .send(out);
  });
};
