import {
  findChannelById,
  getChannelCapability,
  findMetaBusinessAccountByChannelId,
  resolveSystemUserToken,
  resolveAppSecret,
  resolveWebhookVerifyToken,
  findWhatsAppNumberByPhoneNumberId,
  markMetaBusinessAccountUnreachable,
  markWhatsAppWebhookVerified,
  markWhatsAppWebhookVerificationFailed,
  markWhatsAppWebhookEventReceived,
} from "@nextbot/channels";
import {
  findOrCreateConversationForChannelCustomer,
  updateConversationLastInboundAt,
  insertMessage,
} from "@nextbot/conversations";
import { getChannelAdapter, isWithinSessionWindow, type RawRequest, type GenericMessagePayload } from "@nextbot/channel-adapters";
import { WhatsAppTemplateRequiredError, WHATSAPP_TEMPLATE_REQUIRED_MESSAGE } from "@nextbot/contracts";
import type { MessagePayload } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { generateAiReply } from "./turn-pipeline-adapter.js";

/**
 * The Gateway-Plane composition root for the WhatsApp channel's inbound webhook
 * (ADR-0004: all external ingress lives here, mirroring the widget's own ingress
 * and the Git webhook receiver). Reuses the SAME `@nextbot/orchestration` turn
 * pipeline the widget uses (`generateAiReply`, `turn-pipeline-adapter.ts`) — WhatsApp
 * plugs into the existing conversation/message/turn-pipeline infrastructure as a
 * second channel adapter, not a parallel product (per this dispatch's explicit
 * architecture instruction).
 */
export async function verifyWhatsAppWebhookSignature(ctx: TenantContext, channelId: string, req: RawRequest): Promise<boolean> {
  const appSecret = await resolveAppSecret(ctx, channelId);
  const adapter = getChannelAdapter("WhatsApp");
  return adapter.verifyWebhook(req, { id: channelId, tenantId: ctx.tenantId, type: "WhatsApp", config: {} }, appSecret);
}

/**
 * QA D1 fix: records the real outcome of this handshake (`markWhatsAppWebhookVerified`
 * / `markWhatsAppWebhookVerificationFailed`) so the admin console's Webhook tab shows
 * genuine state — never a fabricated always-"Verified" badge — for both Meta's own
 * one-time subscription handshake (this call site) and the admin's "Re-verify
 * Challenge" action (`reverifyWebhookChallenge`, which re-exercises this exact route
 * over a real HTTP round trip rather than duplicating this logic).
 */
export async function verifyWhatsAppSubscriptionHandshake(ctx: TenantContext, channelId: string, req: RawRequest): Promise<string | null> {
  const verifyToken = await resolveWebhookVerifyToken(ctx, channelId);
  const adapter = getChannelAdapter("WhatsApp");
  const challenge = adapter.verifySubscription ? adapter.verifySubscription(req, verifyToken) : null;
  if (challenge !== null) {
    await markWhatsAppWebhookVerified(ctx, channelId);
  } else {
    await markWhatsAppWebhookVerificationFailed(ctx, channelId);
  }
  return challenge;
}

/**
 * Processes one already-signature-verified webhook delivery: parses every inbound
 * customer message (idempotently — see `insertMessage`'s `clientMessageId`-unique
 * dedup, reused here for webhook-redelivery safety per this dispatch's explicit
 * "reuse existing infra, no bespoke dedup table" instruction), runs the real turn
 * pipeline, and dispatches the AI reply back out through the WhatsApp adapter's
 * `send()` — which independently re-derives the 24h session-window rule
 * (FR-META-01) rather than trusting anything computed here.
 */
export async function processWhatsAppWebhookDelivery(ctx: TenantContext, channelId: string, rawBody: string): Promise<{ processed: number }> {
  const channel = await findChannelById(ctx, channelId);
  if (!channel || channel.type !== "WhatsApp") throw new Error(`Channel '${channelId}' is not a WhatsApp channel.`);

  const adapter = getChannelAdapter("WhatsApp");
  const events = await adapter.parseInbound({ rawBody, headers: {}, query: {} }, { id: channelId, tenantId: ctx.tenantId, type: "WhatsApp", config: {} });

  // QA D1 fix: stamp "last event received" for any real, signature-verified
  // delivery (any event kind — message or status update), even one that produces
  // zero processed messages (e.g. a pure status-update payload) — the Webhook
  // tab's timestamp reflects "we heard from Meta", not "we replied".
  if (events.length > 0) {
    await markWhatsAppWebhookEventReceived(ctx, channelId);
  }

  let processed = 0;
  for (const event of events) {
    if (event.kind !== "Message" || !event.customerIdentifier) continue;

    const conversation = await findOrCreateConversationForChannelCustomer(ctx, {
      channelId,
      externalThreadId: event.customerIdentifier,
      customerIdentifier: event.customerIdentifier,
      language: "en",
    });

    // Idempotency: reusing the existing `(tenantId, conversationId, clientMessageId)`
    // unique-index dedup (LLD §5.3) means a redelivered webhook for an
    // already-processed message is a safe no-op, not a special case to detect here.
    const inbound = await insertMessage(ctx, {
      conversationId: conversation.id,
      sender: "Customer",
      contentType: "Text",
      payload: { contentType: "Text", text: event.text ?? "" },
      clientMessageId: event.externalId,
    });
    if (inbound.reused) continue; // already handled by whichever request won the race
    processed += 1;

    await updateConversationLastInboundAt(ctx, conversation.id, event.occurredAt);

    // Phase 17 (BL-48, LLD §15.6): `channelId` was already a parameter of this handler and
    // is simply threaded through now, so a WhatsApp turn resolves its version through the
    // same channel→definition→traffic-split chain the widget does. `liveMessageId` is the
    // inbound message just persisted above, used only as a shadow-evaluation pointer.
    const { payload: aiPayload, runId } = await generateAiReply(ctx, {
      customerPayload: { contentType: "Text", text: event.text ?? "" },
      conversationId: conversation.id,
      channelId,
      liveMessageId: inbound.id,
    });
    await insertMessage(ctx, {
      conversationId: conversation.id,
      sender: "AI",
      contentType: aiPayload.contentType,
      payload: aiPayload as unknown as Record<string, unknown>,
      agentRunId: runId,
    });

    await dispatchWhatsAppReply(ctx, channelId, conversation.id, event.customerIdentifier, event.phoneNumberId, aiPayload, event.occurredAt);
  }
  return { processed };
}

/**
 * FR-META-01's pre-send enforcement, wired into the real send path: renders the AI
 * reply through the WhatsApp adapter (`render()` — quick-reply -> button mapping,
 * truncation/pagination) and sends each resulting payload. A
 * `WhatsAppTemplateRequiredError` (thrown by `send()` itself, never assumed here)
 * is surfaced as a `System`-sender transcript message with the exact spec copy —
 * never silently dropped, never re-routed to another channel.
 */
async function dispatchWhatsAppReply(
  ctx: TenantContext,
  channelId: string,
  conversationId: string,
  toCustomer: string,
  phoneNumberId: string | undefined,
  aiPayload: MessagePayload,
  lastInboundAt: string,
): Promise<void> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) return; // Not (yet) linked — nothing to send through.

  // The inbound webhook payload always carries the receiving business
  // phone-number-id (Meta's `value.metadata.phone_number_id`) — this lookup just
  // confirms it's one of this tenant's own registered numbers before sending
  // through it (never trusts the payload's number blindly for an outbound send).
  if (!phoneNumberId) return;
  const registeredNumber = await findWhatsAppNumberByPhoneNumberId(ctx, phoneNumberId);
  if (!registeredNumber) return;
  const resolvedPhoneNumberId = registeredNumber.phoneNumberId;

  const capability = await getChannelCapability(ctx, "WhatsApp");
  const adapter = getChannelAdapter("WhatsApp");
  const outboundPayloads = adapter.render(toGenericPayload(aiPayload), {
    supportsRichCards: capability?.supportsRichCards ?? false,
    supportsQuickReplies: capability?.supportsQuickReplies ?? false,
    maxQuickReplies: capability?.maxQuickReplies ?? null,
    maxButtonLabelChars: capability?.maxButtonLabelChars ?? null,
    maxTextChars: capability?.maxTextChars ?? null,
  });

  const { accessToken } = await resolveSystemUserToken(ctx, channelId);

  for (const outbound of outboundPayloads) {
    try {
      await adapter.send(outbound, { id: channelId, tenantId: ctx.tenantId, type: "WhatsApp", config: {} }, {
        accessToken,
        phoneNumberId: resolvedPhoneNumberId,
        to: toCustomer,
        lastInboundAt,
        // Test-only override so integration tests can point this at a local mock
        // Meta Graph server instead of the real `graph.facebook.com` — unset in
        // every real deployment, where `adapter.send`'s own default applies.
        graphApiBaseUrl: process.env.NEXTBOT_META_GRAPH_API_BASE_URL,
      });
    } catch (err) {
      if (err instanceof WhatsAppTemplateRequiredError) {
        await insertMessage(ctx, {
          conversationId,
          sender: "System",
          contentType: "Text",
          payload: { contentType: "Text", text: WHATSAPP_TEMPLATE_REQUIRED_MESSAGE },
        });
        continue;
      }
      await markMetaBusinessAccountUnreachable(ctx, channelId);
      console.error("WhatsApp send failed", err);
    }
  }
}

function toGenericPayload(payload: MessagePayload): GenericMessagePayload {
  if (payload.contentType === "QuickReply") {
    return { contentType: "QuickReply", text: payload.text, chips: payload.chips };
  }
  if (payload.contentType === "Text") {
    return { contentType: "Text", text: payload.text };
  }
  // Every other rich content type (DataTable/DataSummary/Document/...) degrades to
  // its plain-text summary on WhatsApp per FR-OC-06 — this dispatch keeps that
  // degradation intentionally simple (a text fallback), consistent with
  // `channel_capability.supportsRichCards = false` already seeded for WhatsApp.
  return { contentType: "Other", text: textSummaryOf(payload) };
}

function textSummaryOf(payload: MessagePayload): string {
  switch (payload.contentType) {
    case "DataSummary":
      return payload.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
    case "Document":
      return `${payload.title}: ${payload.url}`;
    case "ExternalLink":
      return `${payload.title}: ${payload.url}`;
    case "Error":
      return payload.text;
    default:
      return "";
  }
}

export { isWithinSessionWindow };
