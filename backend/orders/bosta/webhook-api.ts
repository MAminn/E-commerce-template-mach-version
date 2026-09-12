import type { FastifyPluginAsync } from "fastify";
import { runBackendEffect } from "#root/shared/backend/effect";
import { provideDatabase } from "#root/shared/trpc/server";
import { isBostaEnabled } from "./client";
import { bostaWebhookSchema, processBostaWebhook } from "./webhook-service";
import {
  getBostaWebhookAllowedIps,
  getBostaWebhookSecret,
  isIpAllowed,
  verifyBostaWebhookSecret,
} from "./webhook-auth";

/**
 * POST /api/webhooks/bosta — receives Bosta delivery state changes.
 *
 * Bosta dashboard configuration (Settings → API Integration → Set Up Your
 * Webhook): URL = https://<store>/api/webhooks/bosta, custom header
 * `Authorization` = BOSTA_WEBHOOK_SECRET.
 *
 * Env is read per request (not at import time) so the route reflects the
 * live configuration and is straightforward to exercise in tests.
 */
export const bostaWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!isBostaEnabled()) {
    fastify.log.info("[Bosta Webhook] SYN_BOSTA_KEY not set — webhook endpoint disabled");
    return;
  }

  if (!getBostaWebhookSecret()) {
    fastify.log.warn(
      "[Bosta Webhook] BOSTA_WEBHOOK_SECRET not set — webhook will reject all requests",
    );
  }

  fastify.post("/", async (request, reply) => {
    const log = request.log.child({ module: "bosta-webhook" });

    const secret = getBostaWebhookSecret();
    if (!secret) {
      return reply.status(503).send({ success: false, error: "Webhook not configured" });
    }

    const allowedIps = getBostaWebhookAllowedIps();
    if (!isIpAllowed(request.ip, allowedIps)) {
      log.warn({ ip: request.ip }, "Bosta webhook: source IP not in BOSTA_WEBHOOK_ALLOWED_IPS");
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

    const authHeader = request.headers["authorization"];
    if (!verifyBostaWebhookSecret(authHeader, secret)) {
      log.warn("Bosta webhook: missing or invalid Authorization header");
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const parsed = bostaWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      log.warn({ errors: parsed.error.format() }, "Bosta webhook: invalid payload");
      return reply.status(400).send({ success: false, error: "Invalid payload" });
    }

    log.info(
      {
        trackingNumber: parsed.data.trackingNumber,
        state: parsed.data.state,
        businessReference: parsed.data.businessReference,
      },
      "Bosta webhook received",
    );

    const result = await runBackendEffect(
      processBostaWebhook(parsed.data, authHeader, secret).pipe(
        provideDatabase({ db: request.db }),
      ),
    );

    if (result.success) {
      return reply.status(200).send({ success: true });
    }

    log.error({ error: result.error }, "Bosta webhook processing error");
    const statusCode = (result.error as { statusCode?: number }).statusCode ?? 500;
    return reply.status(statusCode).send({
      success: false,
      error: (result.error as { clientMessage?: string }).clientMessage ?? "Internal error",
    });
  });
};
