import type { FastifyPluginAsync } from "fastify";
import { db } from "#root/shared/database/drizzle/db";
import { getPublicCountdown } from "./service";

/**
 * GET /api/sale-countdown — what the storefront banner counts down to.
 *
 * A plain route rather than a tRPC query so the response can say
 * `Cache-Control: no-store` explicitly: the deadline is server truth and no
 * browser, proxy or CDN may answer with an old copy. `serverNow` lets the
 * browser correct for its own clock being wrong.
 */
export const saleCountdownApiPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/sale-countdown", async (_request, reply) => {
    void reply.header("Cache-Control", "no-store, max-age=0");
    try {
      return reply.send(await getPublicCountdown(db()));
    } catch (error) {
      console.error("[SaleCountdown] Public read failed:", error);
      // Fail hidden: no countdown is better than a wrong one.
      return reply.code(503).send({ active: false, endsAt: null, label: "", serverNow: new Date().toISOString() });
    }
  });
};
