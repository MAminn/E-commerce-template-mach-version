import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Redacted } from "effect";

// ─── Mock nodemailer ────────────────────────────────────────────────────────
// createTransport is called once inside makeEmailService; we control what
// sendMail does per-test via this mock's return/throw behavior.

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(
  (..._args: unknown[]) => ({ sendMail: sendMailMock }),
);

vi.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

// Import after the mock is registered so the module under test picks it up.
const { makeEmailService, createDummyEmailService, maskEmailAddress } = await import(
  "#root/shared/email/service"
);
const { describeSendingIdentity } = await import("#root/shared/email/from-env");

// ─── Helpers ────────────────────────────────────────────────────────────────

function baseInput(overrides?: Partial<Parameters<typeof makeEmailService>[0]>) {
  return {
    smtpHost: "smtp.example.com",
    smtpUser: "login@example.com",
    smtpPassword: Redacted.make("secret"),
    smtpPort: 465,
    ...overrides,
  };
}

describe("makeEmailService", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: "msg-1" });
  });

  it("sends using smtpUser as the From address when no override is given", async () => {
    const service = await Effect.runPromise(makeEmailService(baseInput()));
    const result = await Effect.runPromise(
      service.sendEmail("to@example.com", "Subject", "<p>Body</p>"),
    );

    expect(result).toEqual({ success: true, messageId: "msg-1" });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "login@example.com",
        to: "to@example.com",
        subject: "Subject",
        html: "<p>Body</p>",
      }),
    );
  });

  it("uses fromAddress/fromName from makeEmailService input when provided", async () => {
    const service = await Effect.runPromise(
      makeEmailService(
        baseInput({ fromAddress: "cr@syntperfumes.com", fromName: "SYNT" }),
      ),
    );
    await Effect.runPromise(
      service.sendEmail("to@example.com", "Subject", "<p>Body</p>"),
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"SYNT" <cr@syntperfumes.com>',
      }),
    );
  });

  it("lets per-call options override the default From address/name", async () => {
    const service = await Effect.runPromise(
      makeEmailService(
        baseInput({ fromAddress: "cr@syntperfumes.com", fromName: "SYNT" }),
      ),
    );
    await Effect.runPromise(
      service.sendEmail("to@example.com", "Subject", "<p>Body</p>", {
        fromAddress: "orders@syntperfumes.com",
        fromName: "SYNT Orders",
        replyTo: "help@syntperfumes.com",
        headers: { "List-Unsubscribe": "<mailto:unsub@syntperfumes.com>" },
      }),
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"SYNT Orders" <orders@syntperfumes.com>',
        replyTo: "help@syntperfumes.com",
        headers: { "List-Unsubscribe": "<mailto:unsub@syntperfumes.com>" },
      }),
    );
  });

  it("returns success:false with an error message when sendMail rejects, without throwing", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("connection refused"));
    const service = await Effect.runPromise(makeEmailService(baseInput()));

    const result = await Effect.runPromise(
      service.sendEmail("to@example.com", "Subject", "<p>Body</p>"),
    );

    expect(result).toEqual({ success: false, error: "connection refused" });
  });

  it("converts embedded base64 data URIs into CID inline attachments", async () => {
    const service = await Effect.runPromise(makeEmailService(baseInput()));
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    await Effect.runPromise(
      service.sendEmail(
        "to@example.com",
        "Subject",
        `<img src="data:image/png;base64,${tinyPngBase64}" />`,
      ),
    );

    const call = sendMailMock.mock.calls[0]?.[0];
    expect(call.html).toContain('src="cid:inline-img-0"');
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0]).toMatchObject({
      filename: "logo.png",
      cid: "inline-img-0",
    });
    expect(Buffer.isBuffer(call.attachments[0].content)).toBe(true);
  });

  it("strips http(s):// prefixes accidentally left on the SMTP host", async () => {
    await Effect.runPromise(
      makeEmailService(baseInput({ smtpHost: "https://smtp.example.com" })),
    );

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com" }),
    );
  });

  // ── Provider acceptance is the only success ─────────────────────────────
  it("reports success only when the SMTP server accepted the recipient, with its Message-ID and reply", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<abc@mach.test>",
      accepted: ["To@Example.com"],
      rejected: [],
      response: "250 2.0.0 OK 1700000000 x1-gsmtp",
    });
    const service = await Effect.runPromise(makeEmailService(baseInput()));
    const result = await Effect.runPromise(service.sendEmail("to@example.com", "S", "<p>B</p>"));
    expect(result).toEqual({
      success: true,
      messageId: "<abc@mach.test>",
      response: "250 2.0.0 OK 1700000000 x1-gsmtp",
    });
  });

  it("is a failure when sendMail resolves but the recipient was rejected", async () => {
    sendMailMock.mockResolvedValueOnce({
      messageId: "<abc@mach.test>",
      accepted: [],
      rejected: ["to@example.com"],
      response: "550 5.1.1 user unknown",
    });
    const service = await Effect.runPromise(makeEmailService(baseInput()));
    const result = await Effect.runPromise(service.sendEmail("to@example.com", "S", "<p>B</p>"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not accepted.*550 5\.1\.1/);
    expect(result.messageId).toBeUndefined();
  });

  it("is a failure when the accepted list does not contain this recipient", async () => {
    sendMailMock.mockResolvedValueOnce({ accepted: ["someone-else@example.com"], rejected: [] });
    const service = await Effect.runPromise(makeEmailService(baseInput()));
    const result = await Effect.runPromise(service.sendEmail("to@example.com", "S", "<p>B</p>"));
    expect(result.success).toBe(false);
  });

  it("passes a stable Message-ID through (bracketed) and applies the default Reply-To", async () => {
    const service = await Effect.runPromise(
      makeEmailService(baseInput({ fromAddress: "orders@mach.test", fromName: "Mach", replyTo: "support@mach.test" })),
    );
    await Effect.runPromise(
      service.sendEmail("to@example.com", "S", "<p>B</p>", { messageId: "order-confirmation.1@mach.test" }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Mach" <orders@mach.test>',
        replyTo: "support@mach.test",
        messageId: "<order-confirmation.1@mach.test>",
      }),
    );
  });

  it("configures transport-level timeouts (no outer race that can report failure while still delivering)", async () => {
    await Effect.runPromise(makeEmailService(baseInput()));
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 45_000 }),
    );
  });

  it("never writes the full recipient address or the message body to logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      sendMailMock.mockRejectedValueOnce(Object.assign(new Error("Invalid login"), { responseCode: 535 }));
      const service = await Effect.runPromise(makeEmailService(baseInput()));
      await Effect.runPromise(service.sendEmail("customer.private@example.com", "S", "<p>SECRET-ADDRESS-LINE</p>"));
      const output = [...log.mock.calls, ...error.mock.calls].flat().map(String).join(" | ");
      expect(output).not.toContain("customer.private@example.com");
      expect(output).not.toContain("SECRET-ADDRESS-LINE");
      expect(output).toContain("cu***@example.com");
      expect(output).toContain("[535]");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("falls back to a dummy (no-op) service when transport creation throws", async () => {
    createTransportMock.mockImplementationOnce(() => {
      throw new Error("bad config");
    });
    const service = await Effect.runPromise(makeEmailService(baseInput()));

    const result = await Effect.runPromise(
      service.sendEmail("to@example.com", "Subject", "<p>Body</p>"),
    );

    expect(result.success).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("createDummyEmailService", () => {
  it("logs a warning and reports success:false without sending", async () => {
    const warn = vi.fn();
    const service = createDummyEmailService({
      warn,
    } as unknown as Parameters<typeof createDummyEmailService>[0]);

    const result = await Effect.runPromise(
      service.sendEmail("to@example.com", "Subject", "<p>Body</p>"),
    );

    expect(result.success).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe("maskEmailAddress", () => {
  it("keeps only the first two characters of the local part", () => {
    expect(maskEmailAddress("mohamed@example.com")).toBe("mo***@example.com");
    expect(maskEmailAddress("a@b.co")).toBe("a***@b.co");
    expect(maskEmailAddress("")).toBe("(none)");
    expect(maskEmailAddress("not-an-address")).toBe("***");
  });
});

describe("describeSendingIdentity", () => {
  it("flags a custom From domain sent through a consumer Gmail mailbox (DMARC cannot align)", () => {
    const id = describeSendingIdentity({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "store.owner@gmail.com",
      EMAIL_FROM_ADDRESS: "orders@machsupplements.com",
      EMAIL_FROM_NAME: "Mach Supplements",
      EMAIL_REPLY_TO: "support@machsupplements.com",
    } as NodeJS.ProcessEnv);
    expect(id.fromDomain).toBe("machsupplements.com");
    expect(id.smtpUserDomain).toBe("gmail.com");
    expect(id.warnings.join(" ")).toMatch(/cannot DKIM-sign.*machsupplements\.com/);
  });

  it("has no alignment warning when the SMTP login is on the From domain (e.g. Hostinger mailbox)", () => {
    const id = describeSendingIdentity({
      SMTP_HOST: "smtp.hostinger.com",
      SMTP_USER: "orders@machsupplements.com",
      EMAIL_FROM_ADDRESS: "orders@machsupplements.com",
      EMAIL_FROM_NAME: "Mach Supplements",
      EMAIL_REPLY_TO: "support@machsupplements.com",
    } as NodeJS.ProcessEnv);
    expect(id.warnings).toEqual([]);
  });

  it("defaults From to the SMTP login and reports missing name / Reply-To", () => {
    const id = describeSendingIdentity({ SMTP_HOST: "smtp.example.com", SMTP_USER: "a@example.com" } as NodeJS.ProcessEnv);
    expect(id.fromAddress).toBe("a@example.com");
    expect(id.warnings.some((w) => w.includes("EMAIL_FROM_NAME"))).toBe(true);
    expect(id.warnings.some((w) => w.includes("EMAIL_REPLY_TO"))).toBe(true);
  });
});

describe("SMTP security mode", () => {
  beforeEach(() => {
    createTransportMock.mockClear();
  });

  it("follows the port when SMTP_SECURE is unset: 465 implicit TLS, others STARTTLS", async () => {
    const { resolveSmtpSecure } = await import("#root/shared/email/service");
    expect(resolveSmtpSecure(465)).toBe(true);
    expect(resolveSmtpSecure(587)).toBe(false);
    expect(resolveSmtpSecure(25)).toBe(false);
    expect(resolveSmtpSecure(2525, "")).toBe(false);
  });

  it("honours an explicit SMTP_SECURE override", async () => {
    const { resolveSmtpSecure } = await import("#root/shared/email/service");
    expect(resolveSmtpSecure(587, "true")).toBe(true);
    expect(resolveSmtpSecure(587, "SSL")).toBe(true);
    expect(resolveSmtpSecure(465, "false")).toBe(false);
    expect(resolveSmtpSecure(465, "starttls")).toBe(false);
    expect(resolveSmtpSecure(465, "nonsense")).toBe(true);
  });

  it("port 465 → implicit TLS transport (unchanged behaviour)", async () => {
    await Effect.runPromise(makeEmailService(baseInput({ smtpPort: 465 })));
    const opts = createTransportMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(opts).toMatchObject({ port: 465, secure: true });
    expect(opts.requireTLS).toBeUndefined();
  });

  it("port 587 → STARTTLS required (never authenticates in plain text)", async () => {
    await Effect.runPromise(makeEmailService(baseInput({ smtpPort: 587 })));
    const opts = createTransportMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(opts).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it("explicit smtpSecure wins over the port default", async () => {
    await Effect.runPromise(makeEmailService(baseInput({ smtpPort: 587, smtpSecure: true })));
    const opts = createTransportMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(opts).toMatchObject({ port: 587, secure: true });
  });
});
