import { Redacted } from "effect";
import { z } from "zod";
import { runBackendEffect } from "../backend/effect";
import {
  type EmailServiceInterface,
  makeEmailService,
  createDummyEmailService,
  maskEmailAddress,
} from "./service";

const domainOf = (address: string | undefined) => {
  const at = address?.lastIndexOf("@") ?? -1;
  return address && at > 0 ? address.slice(at + 1).trim().toLowerCase() : undefined;
};

/** Consumer mailbox domains whose SMTP can only DKIM-sign as themselves. */
const CONSUMER_MAILBOX_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com"]);

export interface SendingIdentity {
  smtpHost: string;
  smtpUserDomain: string | undefined;
  fromAddress: string | undefined;
  fromDomain: string | undefined;
  fromName: string | undefined;
  replyTo: string | undefined;
  /** Human-readable deliverability problems detectable from config alone. */
  warnings: string[];
}

/**
 * What the transport will actually claim to be, from env alone (no network).
 * DMARC passes only when SPF or DKIM authenticates a domain ALIGNED with the
 * From header domain. A consumer mailbox (smtp.gmail.com with an @gmail.com
 * login) signs DKIM as gmail.com and uses a gmail.com envelope sender, so a
 * From on any other domain can never align — Gmail either rewrites the From
 * back to the login address or the message fails DMARC.
 */
export function describeSendingIdentity(env: NodeJS.ProcessEnv): SendingIdentity {
  const smtpHost = (env.SMTP_HOST || "").replace(/^https?:\/\//, "").trim().toLowerCase();
  const smtpUser = (env.SMTP_USER || "").trim();
  const fromAddress = (env.EMAIL_FROM_ADDRESS || "").trim() || smtpUser || undefined;
  const fromName = (env.EMAIL_FROM_NAME || "").trim() || undefined;
  const replyTo = (env.EMAIL_REPLY_TO || "").trim() || undefined;
  const smtpUserDomain = domainOf(smtpUser);
  const fromDomain = domainOf(fromAddress);
  const warnings: string[] = [];

  if (fromDomain && smtpUserDomain && fromDomain !== smtpUserDomain && CONSUMER_MAILBOX_DOMAINS.has(smtpUserDomain)) {
    warnings.push(
      `From domain ${fromDomain} is sent through a consumer ${smtpUserDomain} mailbox (${smtpHost}). ` +
        `It cannot DKIM-sign or provide an SPF-aligned envelope for ${fromDomain}, so DMARC alignment fails ` +
        `(or the provider rewrites From to the login address). Use an SMTP service authorised for ${fromDomain}.`,
    );
  }
  if (!fromName) warnings.push("EMAIL_FROM_NAME is unset — recipients see a bare address.");
  if (!replyTo) warnings.push("EMAIL_REPLY_TO is unset — replies go to the From address.");
  return { smtpHost, smtpUserDomain, fromAddress, fromDomain, fromName, replyTo, warnings };
}

/**
 * Minimal logger shape both FastifyBaseLogger and a plain console wrapper
 * satisfy, so this can be called from an HTTP request context (the Fastify
 * middleware) and from a standalone background process (the automation
 * worker) without either one pulling in the other's dependencies.
 */
export interface EmailEnvLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const smtpVariablesSchema = z.object({
  smtpHost: z.string(),
  smtpPort: z.number(),
  smtpUser: z.string(),
  smtpPassword: z.string(),
});

interface TimeoutResult {
  success: false;
  error: string;
}

type MakeEmailServiceResult =
  | { success: true; result: EmailServiceInterface }
  | { success: false; error: unknown };

/**
 * Reads SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD (+ optional
 * EMAIL_FROM_ADDRESS/EMAIL_FROM_NAME) from process.env and builds a real
 * EmailServiceInterface, falling back to a no-op dummy service (logs
 * instead of sending) on any missing config, validation error, timeout, or
 * unexpected failure. Never throws — this is the single source of truth for
 * "how do we get an EmailServiceInterface from env vars", used by both the
 * Fastify request middleware and the standalone automation worker so the
 * two never drift out of sync with each other.
 */
export async function createEmailServiceFromEnv(
  logger: EmailEnvLogger,
): Promise<EmailServiceInterface> {
  try {
    logger.info("Initializing email service from environment");

    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_PORT ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    ) {
      logger.warn("Missing SMTP configuration environment variables");
      return createDummyEmailService(logger);
    }

    const validationResult = smtpVariablesSchema.safeParse({
      smtpHost: process.env.SMTP_HOST,
      smtpPort: Number(process.env.SMTP_PORT),
      smtpUser: process.env.SMTP_USER,
      smtpPassword: process.env.SMTP_PASSWORD,
    });

    if (!validationResult.success) {
      logger.error({
        msg: "Invalid SMTP configuration",
        errors: validationResult.error.format(),
      });
      return createDummyEmailService(logger);
    }

    const identity = describeSendingIdentity(process.env);
    logger.info({
      msg: "Setting up email service with configuration",
      host: identity.smtpHost,
      port: validationResult.data.smtpPort,
      user: maskEmailAddress(validationResult.data.smtpUser),
      from: maskEmailAddress(identity.fromAddress),
      fromName: identity.fromName ?? "(unset)",
      replyTo: maskEmailAddress(identity.replyTo),
    });
    for (const warning of identity.warnings) {
      logger.warn({ msg: `[Email identity] ${warning}` });
    }

    const data = {
      ...validationResult.data,
      smtpPassword: Redacted.make(validationResult.data.smtpPassword),
      fromAddress: identity.fromAddress || undefined,
      fromName: identity.fromName || undefined,
      replyTo: identity.replyTo || undefined,
    };

    const timeoutPromise = new Promise<TimeoutResult>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          error: "Email service initialization timed out after 5 seconds",
        });
      }, 5000);
    });

    let makeEmailServicePromise: Promise<MakeEmailServiceResult>;
    try {
      // @ts-ignore - runBackendEffect's success channel is EmailServiceInterface here;
      // the effect never fails, only the discriminated result matters.
      makeEmailServicePromise = runBackendEffect(makeEmailService(data));
    } catch (err) {
      logger.error({ msg: "Error running makeEmailService effect", error: err });
      return createDummyEmailService(logger);
    }

    const result = (await Promise.race([
      makeEmailServicePromise,
      timeoutPromise,
    ])) as MakeEmailServiceResult | TimeoutResult;

    if ("success" in result && result.success) {
      logger.info("Email service initialized successfully");
      return result.result;
    }

    logger.warn({
      msg: "Using dummy email service due to initialization failure",
      error: "error" in result ? result.error : "Unknown error",
    });
    return createDummyEmailService(logger as unknown as Parameters<typeof createDummyEmailService>[0]);
  } catch (error) {
    logger.error({ msg: "Unexpected error initializing email service", error });
    return createDummyEmailService(logger as unknown as Parameters<typeof createDummyEmailService>[0]);
  }
}
