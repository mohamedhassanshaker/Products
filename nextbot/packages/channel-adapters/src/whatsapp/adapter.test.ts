import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { WhatsAppTemplateRequiredError, WHATSAPP_TEMPLATE_REQUIRED_MESSAGE } from "@nextbot/contracts";
import { startMockMetaGraphServer, createMockMetaGraphState, type MockMetaGraphState } from "@nextbot/testing";
import { whatsAppAdapter, isWithinSessionWindow } from "./adapter.js";
import type { ChannelCapability, ChannelDto } from "../port.js";

const WHATSAPP_CAPABILITY: ChannelCapability = {
  supportsRichCards: true,
  supportsQuickReplies: true,
  maxQuickReplies: 3,
  maxButtonLabelChars: 20,
  maxTextChars: 4096,
};

const CHANNEL: ChannelDto = { id: "chan-1", tenantId: "tenant-1", type: "WhatsApp", config: {} };

describe("whatsAppAdapter.verifyWebhook (FR-META signature verification)", () => {
  it("accepts a genuinely valid X-Hub-Signature-256 HMAC", async () => {
    const secret = "test-app-secret";
    const rawBody = JSON.stringify({ hello: "world" });
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
    const ok = await whatsAppAdapter.verifyWebhook({ rawBody, headers: { "x-hub-signature-256": signature }, query: {} }, CHANNEL, secret);
    expect(ok).toBe(true);
  });

  it("rejects a forged/unsigned payload", async () => {
    const ok = await whatsAppAdapter.verifyWebhook({ rawBody: "{}", headers: { "x-hub-signature-256": "sha256=deadbeef" }, query: {} }, CHANNEL, "real-secret");
    expect(ok).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const rawBody = "{}";
    const wrongSignature = `sha256=${createHmac("sha256", "wrong-secret").update(rawBody, "utf8").digest("hex")}`;
    const ok = await whatsAppAdapter.verifyWebhook({ rawBody, headers: { "x-hub-signature-256": wrongSignature }, query: {} }, CHANNEL, "real-secret");
    expect(ok).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    const ok = await whatsAppAdapter.verifyWebhook({ rawBody: "{}", headers: {}, query: {} }, CHANNEL, "real-secret");
    expect(ok).toBe(false);
  });
});

describe("whatsAppAdapter.verifySubscription (hub.challenge handshake)", () => {
  it("echoes hub.challenge when hub.verify_token matches", () => {
    const challenge = whatsAppAdapter.verifySubscription!(
      { rawBody: "", headers: {}, query: { "hub.mode": "subscribe", "hub.verify_token": "correct-token", "hub.challenge": "12345" } },
      "correct-token",
    );
    expect(challenge).toBe("12345");
  });

  it("returns null when hub.verify_token does not match", () => {
    const challenge = whatsAppAdapter.verifySubscription!(
      { rawBody: "", headers: {}, query: { "hub.mode": "subscribe", "hub.verify_token": "wrong-token", "hub.challenge": "12345" } },
      "correct-token",
    );
    expect(challenge).toBeNull();
  });
});

describe("whatsAppAdapter.parseInbound", () => {
  it("parses an inbound customer text message", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn-1" },
                messages: [{ id: "wamid.abc", from: "15551234567", timestamp: "1700000000", text: { body: "Hello" } }],
              },
            },
          ],
        },
      ],
    };
    const events = await whatsAppAdapter.parseInbound({ rawBody: JSON.stringify(payload), headers: {}, query: {} }, CHANNEL);
    expect(events).toEqual([
      {
        kind: "Message",
        externalId: "wamid.abc",
        customerIdentifier: "15551234567",
        text: "Hello",
        occurredAt: new Date(1700000000 * 1000).toISOString(),
        phoneNumberId: "pn-1",
      },
    ]);
  });

  it("parses a delivery status callback", async () => {
    const payload = {
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.abc", status: "delivered", timestamp: "1700000000" }] } }] }],
    };
    const events = await whatsAppAdapter.parseInbound({ rawBody: JSON.stringify(payload), headers: {}, query: {} }, CHANNEL);
    expect(events[0]?.kind).toBe("StatusUpdate");
    expect(events[0]?.status).toBe("Delivered");
  });
});

describe("whatsAppAdapter.render (FR-META-01 quick-reply -> button mapping)", () => {
  it("maps up to 3 chips to interactive buttons unchanged", () => {
    const result = whatsAppAdapter.render(
      { contentType: "QuickReply", text: "Pick one", chips: [{ id: "a", label: "Yes" }, { id: "b", label: "No" }] },
      WHATSAPP_CAPABILITY,
    );
    expect(result).toEqual([{ kind: "interactive-buttons", text: "Pick one", buttons: [{ id: "a", label: "Yes" }, { id: "b", label: "No" }] }]);
  });

  it("paginates chips beyond the 3-button limit into a follow-up list", () => {
    const chips = [
      { id: "a", label: "One" },
      { id: "b", label: "Two" },
      { id: "c", label: "Three" },
      { id: "d", label: "Four" },
      { id: "e", label: "Five" },
    ];
    const result = whatsAppAdapter.render({ contentType: "QuickReply", chips }, WHATSAPP_CAPABILITY);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe("interactive-buttons");
    expect(result[0]?.buttons).toHaveLength(3);
    expect(result[1]?.kind).toBe("interactive-list");
    expect(result[1]?.buttons).toHaveLength(2);
  });

  it("truncates a button label exceeding 20 chars with an ellipsis", () => {
    const result = whatsAppAdapter.render(
      { contentType: "QuickReply", chips: [{ id: "a", label: "This label is definitely longer than twenty characters" }] },
      WHATSAPP_CAPABILITY,
    );
    const label = result[0]?.buttons?.[0]?.label ?? "";
    expect(label.length).toBe(20);
    expect(label.endsWith("…")).toBe(true);
  });

  it("paginates generic text exceeding maxTextChars rather than failing", () => {
    const longText = "x".repeat(9000);
    const result = whatsAppAdapter.render({ contentType: "Text", text: longText }, WHATSAPP_CAPABILITY);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((p) => (p.text?.length ?? 0) <= 4096)).toBe(true);
    expect(result.map((p) => p.text).join("")).toBe(longText);
  });
});

describe("isWithinSessionWindow (FR-META-01, 24h)", () => {
  it("is true just under 24h after the last inbound message", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const lastInbound = new Date("2026-01-01T01:00:00Z").toISOString();
    expect(isWithinSessionWindow(lastInbound, now)).toBe(true);
  });

  it("is false just over 24h after the last inbound message", () => {
    const now = new Date("2026-01-02T02:00:00Z");
    const lastInbound = new Date("2026-01-01T01:00:00Z").toISOString();
    expect(isWithinSessionWindow(lastInbound, now)).toBe(false);
  });

  it("is false (fails closed) when there has never been an inbound message", () => {
    expect(isWithinSessionWindow(null)).toBe(false);
  });
});

describe("whatsAppAdapter.send (FR-META-01 pre-send enforcement + real Meta Graph API round trip)", () => {
  let state: MockMetaGraphState;
  let server: { url: string; close: () => Promise<void> };

  afterEach(async () => {
    await server?.close();
  });

  it("rejects with the exact spec copy before calling Meta at all, outside the window with no template", async () => {
    state = createMockMetaGraphState();
    server = await startMockMetaGraphServer(state);

    await expect(
      whatsAppAdapter.send(
        { kind: "text", text: "hi" },
        CHANNEL,
        { accessToken: "t", phoneNumberId: "pn-1", to: "15551234567", lastInboundAt: null, graphApiBaseUrl: server.url },
      ),
    ).rejects.toThrow(WhatsAppTemplateRequiredError);
    await expect(
      whatsAppAdapter.send(
        { kind: "text", text: "hi" },
        CHANNEL,
        { accessToken: "t", phoneNumberId: "pn-1", to: "15551234567", lastInboundAt: null, graphApiBaseUrl: server.url },
      ),
    ).rejects.toThrow(WHATSAPP_TEMPLATE_REQUIRED_MESSAGE);
    expect(state.sentMessages).toHaveLength(0);
  });

  it("sends for real (against the mock Meta server) when within the 24h window", async () => {
    state = createMockMetaGraphState();
    server = await startMockMetaGraphServer(state);

    const receipt = await whatsAppAdapter.send(
      { kind: "text", text: "hi" },
      CHANNEL,
      { accessToken: "t", phoneNumberId: "pn-1", to: "15551234567", lastInboundAt: new Date().toISOString(), graphApiBaseUrl: server.url },
    );
    expect(receipt.externalMessageId).toMatch(/^wamid\.mock-/);
    expect(state.sentMessages).toHaveLength(1);
    expect(state.sentMessages[0]?.phoneNumberId).toBe("pn-1");
  });

  it("sends via an approved template even outside the window", async () => {
    state = createMockMetaGraphState();
    server = await startMockMetaGraphServer(state);

    const receipt = await whatsAppAdapter.send(
      { kind: "text", text: "hi" },
      CHANNEL,
      {
        accessToken: "t",
        phoneNumberId: "pn-1",
        to: "15551234567",
        lastInboundAt: null,
        approvedTemplate: { name: "order_update", language: "en_US" },
        graphApiBaseUrl: server.url,
      },
    );
    expect(receipt.externalMessageId).toBeTruthy();
    expect(state.sentMessages[0]?.body).toMatchObject({ type: "template" });
  });
});
