import { describe, expect, it } from "vitest";
import {
  MetaBusinessAccountNotFoundError,
  WhatsAppNumberDuplicateError,
  WhatsAppTemplateRequiredError,
  WhatsAppWebhookVerificationFailedError,
  WhatsAppMetaVerificationFailedError,
  WHATSAPP_TEMPLATE_REQUIRED_MESSAGE,
} from "./whatsapp.js";

describe("WhatsApp domain errors (BL-15)", () => {
  it("WhatsAppTemplateRequiredError carries the exact FR-META-01 spec copy", () => {
    const err = new WhatsAppTemplateRequiredError();
    expect(err.code).toBe("WHATSAPP_TEMPLATE_REQUIRED");
    expect(err.httpStatus).toBe(422);
    expect(err.message).toBe(WHATSAPP_TEMPLATE_REQUIRED_MESSAGE);
    expect(err.message).toBe("This message requires an approved WhatsApp template outside the 24-hour session window");
  });

  it("MetaBusinessAccountNotFoundError is a 404", () => {
    const err = new MetaBusinessAccountNotFoundError();
    expect(err.code).toBe("META_BUSINESS_ACCOUNT_NOT_FOUND");
    expect(err.httpStatus).toBe(404);
  });

  it("WhatsAppNumberDuplicateError is a 409", () => {
    const err = new WhatsAppNumberDuplicateError();
    expect(err.code).toBe("WHATSAPP_NUMBER_DUPLICATE");
    expect(err.httpStatus).toBe(409);
  });

  it("WhatsAppWebhookVerificationFailedError is a 401", () => {
    const err = new WhatsAppWebhookVerificationFailedError();
    expect(err.code).toBe("WHATSAPP_WEBHOOK_VERIFICATION_FAILED");
    expect(err.httpStatus).toBe(401);
  });

  it("WhatsAppMetaVerificationFailedError is a 422 and includes the transport detail when supplied", () => {
    const err = new WhatsAppMetaVerificationFailedError("status 401");
    expect(err.code).toBe("WHATSAPP_META_VERIFICATION_FAILED");
    expect(err.httpStatus).toBe(422);
    expect(err.message).toContain("status 401");
  });
});
