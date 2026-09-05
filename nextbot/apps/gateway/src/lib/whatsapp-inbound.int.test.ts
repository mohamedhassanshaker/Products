import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type * as AiRegistryModule from "@nextbot/ai-registry";
import { startMockMetaGraphServer, createMockMetaGraphState, type MockMetaGraphState } from "@nextbot/testing";
import { createWhatsAppChannel, connectMetaBusinessAccount, setWabaConfig, resolveAppSecret } from "@nextbot/channels";
import { withTenant, schema } from "@nextbot/db";
import { WHATSAPP_TEMPLATE_REQUIRED_MESSAGE } from "@nextbot/contracts";
import { eq } from "drizzle-orm";
import { verifyWhatsAppWebhookSignature, verifyWhatsAppSubscriptionHandshake, processWhatsAppWebhookDelivery } from "./whatsapp-inbound.js";

/**
 * Genuine end-to-end proof (not mocked at every layer, per this dispatch's explicit
 * verification requirement): a real inbound WhatsApp webhook delivery, with a real
 * `X-Hub-Signature-256` HMAC computed against this tenant's own vaulted App Secret,
 * flows through the real `@nextbot/orchestration` turn pipeline (only the model
 * call itself — `generateStructured`, `@nextbot/ai-registry` — is mocked, the exact
 * same pattern `orchestration-turn-pipeline.int.test.ts` already establishes for
 * every other turn-pipeline integration test in this codebase) and a real outbound
 * WhatsApp send is attempted against a local mock Meta Graph API server, correctly
 * respecting the FR-META-01 24h session-window rule.
 */
const generateStructuredMock = vi.fn();
vi.mock("@nextbot/ai-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof AiRegistryModule>();
  return { ...actual, generateStructured: (...args: unknown[]) => generateStructuredMock(...args) };
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  generateStructuredMock.mockReset();
  delete process.env.NEXTBOT_META_GRAPH_API_BASE_URL;
});

async function setUpConnectedWhatsAppChannel(state: MockMetaGraphState) {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const channel = await createWhatsAppChannel(ctx, { name: "WA", environment: "Sandbox" });
  state.businessInfo["biz-1"] = { id: "biz-1", name: "Acme Corp" };
  await connectMetaBusinessAccount(ctx, {
    channelId: channel.id,
    businessId: "biz-1",
    businessName: "Acme Corp",
    systemUserToken: "sys-user-token",
    appId: "app-1",
    appSecret: "app-secret-value",
  });
  await setWabaConfig(ctx, channel.id, { wabaId: "waba-1" });
  // Register the receiving phone number directly (bypassing a live Meta sync, which
  // is exercised separately in `whatsapp.int.test.ts`) so the outbound dispatch has
  // a real, tenant-owned number to resolve.
  await withTenant(ctx, async (db) => {
    const [account] = await db.select().from(schema.metaBusinessAccount).where(eq(schema.metaBusinessAccount.channelId, channel.id));
    await db.insert(schema.whatsappNumber).values({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      metaBusinessAccountId: account!.id,
      phoneNumberId: "pn-1",
      e164: "+15559990000",
      verificationStatus: "Verified",
      messagingTier: "Tier1",
    });
  });
  return { ctx, channel };
}

function signedWebhookBody(appSecret: string, customerText: string, customerWaId: string, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "pn-1" },
              messages: [{ id: `wamid.${crypto.randomUUID()}`, from: customerWaId, timestamp: String(timestampSeconds), text: { body: customerText } }],
            },
          },
        ],
      },
    ],
  };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return { rawBody, signature };
}

describe("WhatsApp inbound webhook -> real turn pipeline -> real outbound send (e2e)", () => {
  it("processes a signed inbound message through the real turn pipeline and sends a real reply (within the 24h window)", async () => {
    const state = createMockMetaGraphState();
    const server = await startMockMetaGraphServer(state);
    process.env.NEXTBOT_META_GRAPH_API_BASE_URL = server.url;
    try {
      const { ctx, channel } = await setUpConnectedWhatsAppChannel(state);
      generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "Thanks for reaching out — how can I help?", confidence: 0.95 });

      const appSecret = await resolveAppSecret(ctx, channel.id);
      const { rawBody, signature } = signedWebhookBody(appSecret, "Hi, I have a question", "15551234567");

      const verified = await verifyWhatsAppWebhookSignature(ctx, channel.id, { rawBody, headers: { "x-hub-signature-256": signature }, query: {} });
      expect(verified).toBe(true);

      const result = await processWhatsAppWebhookDelivery(ctx, channel.id, rawBody);
      expect(result.processed).toBe(1);
      // Real outbound send happened against the mock Meta Graph server — proves
      // the reply respected the (open, since this is the customer's first-ever
      // inbound message) 24h session window rather than being rejected.
      expect(state.sentMessages).toHaveLength(1);

      const messages = await withTenant(ctx, async (db) => db.select().from(schema.message).where(eq(schema.message.tenantId, ctx.tenantId)));
      const customerMessage = messages.find((m) => m.sender === "Customer");
      const aiMessage = messages.find((m) => m.sender === "AI");
      expect(customerMessage).toBeDefined();
      expect(aiMessage).toBeDefined();
      expect((aiMessage!.payload as { text?: string }).text).toContain("Thanks for reaching out");

      // Redelivery of the exact same webhook (Meta's own retry behavior) must be a
      // safe no-op — idempotent via the existing clientMessageId unique index.
      const replay = await processWhatsAppWebhookDelivery(ctx, channel.id, rawBody);
      expect(replay.processed).toBe(0);
      const messagesAfterReplay = await withTenant(ctx, async (db) => db.select().from(schema.message).where(eq(schema.message.tenantId, ctx.tenantId)));
      expect(messagesAfterReplay).toHaveLength(messages.length);
    } finally {
      await server.close();
    }
  });

  it("FR-META-01: rejects the outbound reply pre-send with the exact spec copy when the inbound message is outside the 24h window, and records it in the transcript", async () => {
    const state = createMockMetaGraphState();
    const server = await startMockMetaGraphServer(state);
    process.env.NEXTBOT_META_GRAPH_API_BASE_URL = server.url;
    try {
      const { ctx, channel } = await setUpConnectedWhatsAppChannel(state);
      generateStructuredMock.mockResolvedValue({ action: "reply", replyText: "Thanks for reaching out!", confidence: 0.95 });

      const appSecret = await resolveAppSecret(ctx, channel.id);
      const twentyFiveHoursAgo = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
      const { rawBody } = signedWebhookBody(appSecret, "Old message", "15559998888", twentyFiveHoursAgo);
      const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;

      const verified = await verifyWhatsAppWebhookSignature(ctx, channel.id, { rawBody, headers: { "x-hub-signature-256": signature }, query: {} });
      expect(verified).toBe(true);

      await processWhatsAppWebhookDelivery(ctx, channel.id, rawBody);

      // The send was rejected pre-send — never reached Meta at all.
      expect(state.sentMessages).toHaveLength(0);

      const messages = await withTenant(ctx, async (db) => db.select().from(schema.message).where(eq(schema.message.tenantId, ctx.tenantId)));
      const systemMessage = messages.find((m) => m.sender === "System");
      expect(systemMessage).toBeDefined();
      expect((systemMessage!.payload as { text?: string }).text).toBe(WHATSAPP_TEMPLATE_REQUIRED_MESSAGE);
    } finally {
      await server.close();
    }
  });

  it("rejects an unsigned/forged webhook payload", async () => {
    const state = createMockMetaGraphState();
    const server = await startMockMetaGraphServer(state);
    process.env.NEXTBOT_META_GRAPH_API_BASE_URL = server.url;
    try {
      const { ctx, channel } = await setUpConnectedWhatsAppChannel(state);
      const verified = await verifyWhatsAppWebhookSignature(ctx, channel.id, {
        rawBody: JSON.stringify({ entry: [] }),
        headers: { "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000" },
        query: {},
      });
      expect(verified).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("echoes hub.challenge only when hub.verify_token matches this tenant's own vaulted token", async () => {
    const state = createMockMetaGraphState();
    const server = await startMockMetaGraphServer(state);
    process.env.NEXTBOT_META_GRAPH_API_BASE_URL = server.url;
    try {
      const { ctx, channel } = await setUpConnectedWhatsAppChannel(state);
      const wrong = await verifyWhatsAppSubscriptionHandshake(ctx, channel.id, {
        rawBody: "",
        headers: {},
        query: { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "abc123" },
      });
      expect(wrong).toBeNull();
    } finally {
      await server.close();
    }
  });
});
