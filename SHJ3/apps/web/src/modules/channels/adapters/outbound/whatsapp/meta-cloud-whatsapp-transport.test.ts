import { describe, expect, it } from "vitest";
import { parseMetaWebhookPayload } from "./meta-cloud-whatsapp-transport.js";

function entryWith(value: unknown) {
  return { entry: [{ changes: [{ value }] }] };
}

describe("parseMetaWebhookPayload", () => {
  it("parses a real inbound text message", () => {
    const events = parseMetaWebhookPayload(
      entryWith({
        messages: [
          {
            from: "971501234567",
            id: "wamid.1",
            timestamp: "1700000000",
            type: "text",
            text: { body: "Hi" },
          },
        ],
      }),
    );
    expect(events).toEqual([
      {
        kind: "message",
        from: { address: "971501234567" },
        text: "Hi",
        messageId: "wamid.1",
        occurredAt: new Date(1700000000 * 1000),
      },
    ]);
  });

  it("parses an interactive list-message reply as a list_reply event", () => {
    const events = parseMetaWebhookPayload(
      entryWith({
        messages: [
          {
            from: "971501234567",
            id: "wamid.2",
            timestamp: "1700000000",
            type: "interactive",
            interactive: { list_reply: { id: "pay_bill" } },
          },
        ],
      }),
    );
    expect(events).toEqual([
      {
        kind: "list_reply",
        from: { address: "971501234567" },
        chipId: "pay_bill",
        messageId: "wamid.2",
        occurredAt: new Date(1700000000 * 1000),
      },
    ]);
  });

  it("parses a delivery/read status update", () => {
    const events = parseMetaWebhookPayload(
      entryWith({ statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000000" }] }),
    );
    expect(events).toEqual([
      {
        kind: "delivery_receipt",
        providerMessageId: "wamid.1",
        status: "delivered",
        occurredAt: new Date(1700000000 * 1000),
      },
    ]);
  });

  it("parses a template approval status change", () => {
    const events = parseMetaWebhookPayload(
      entryWith({
        message_template_status_update: { message_template_id: "tmpl-123", event: "APPROVED" },
      }),
    );
    expect(events).toEqual([
      {
        kind: "template_status_changed",
        bspTemplateId: "tmpl-123",
        status: "approved",
        rejectionReason: null,
        occurredAt: expect.any(Date),
      },
    ]);
  });

  it("parses a template rejection with a reason", () => {
    const events = parseMetaWebhookPayload(
      entryWith({
        message_template_status_update: {
          message_template_id: "tmpl-123",
          event: "REJECTED",
          reason: "INVALID_FORMAT",
        },
      }),
    );
    expect(events[0]).toMatchObject({
      kind: "template_status_changed",
      status: "rejected",
      rejectionReason: "INVALID_FORMAT",
    });
  });

  it("returns no events, and does not throw, for an unrecognised shape", () => {
    expect(parseMetaWebhookPayload({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
    expect(parseMetaWebhookPayload({})).toEqual([]);
    expect(() => parseMetaWebhookPayload(null)).not.toThrow();
    expect(parseMetaWebhookPayload(null)).toEqual([]);
  });

  it("ignores a message missing a from/id rather than crashing", () => {
    expect(
      parseMetaWebhookPayload(entryWith({ messages: [{ text: { body: "no sender" } }] })),
    ).toEqual([]);
  });
});
