import { WHATSAPP_TEMPLATE_REQUIRED_MESSAGE, WhatsAppTemplateRequiredError } from "@nextbot/contracts";
import type {
  ChannelAdapter,
  ChannelCapability,
  ChannelDto,
  GenericMessagePayload,
  InboundEvent,
  OutboundPayload,
  RawRequest,
  SendReceipt,
  ValidationResult,
} from "../port.js";
import { verifyMetaSignature } from "./signature.js";
import { createMetaGraphClient, type MetaGraphClient } from "./meta-graph-client.js";

/** FR-META-01: 24 hours, exactly. A named constant (not a magic number scattered
 * across call sites) per LLD §11's "timeouts are always explicit" convention. */
export const WHATSAPP_SESSION_WINDOW_HOURS = 24;

export interface WhatsAppSendOptions {
  /** Already-decrypted credentials (ADR-0004: decryption confined to the Gateway
   * Plane, immediately before this call — never persisted, never logged). */
  accessToken: string;
  phoneNumberId: string;
  graphApiBaseUrl?: string;
  /** The customer's E.164 number this send targets. */
  to: string;
  /** `conversation.metadata.lastInboundAt` (LLD §12.3) — `null` if the customer has
   * never messaged in (no session has ever opened). */
  lastInboundAt: string | null;
  /** Present only when the caller has already resolved (and the tenant has
   * confirmed) an Approved template to use for an outside-window send — `send()`
   * still independently re-derives whether the window is open; this is never
   * trusted blindly as "therefore skip the check." */
  approvedTemplate?: { name: string; language: string; variables?: string[] };
  /** Test-only seam: inject a client pointed at a local mock server instead of the
   * real `graph.facebook.com`. */
  graphClientFactory?: (opts: { accessToken: string; baseUrl?: string }) => MetaGraphClient;
}

/**
 * WhatsApp `ChannelAdapter` (LLD §8, FR-META-01 through META-13). The one channel
 * this dispatch implements for real — Messenger/Instagram remain reserved,
 * not-yet-implemented registry entries (see `registry.ts`).
 */
export const whatsAppAdapter: ChannelAdapter = {
  type: "WhatsApp",

  async verifyWebhook(req: RawRequest, _channel: ChannelDto, appSecret: string): Promise<boolean> {
    return verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"] ?? null, appSecret);
  },

  /** Meta's webhook-subscription handshake (a GET request carrying
   * `hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<value>`) — Meta
   * refuses to deliver any webhook until this echoes `hub.challenge` back verbatim
   * for a request whose `hub.verify_token` matches the tenant's own vaulted token. */
  verifySubscription(req: RawRequest, verifyToken: string): string | null {
    if (req.query["hub.mode"] !== "subscribe") return null;
    if (req.query["hub.verify_token"] !== verifyToken) return null;
    return req.query["hub.challenge"] ?? null;
  },

  async parseInbound(req: RawRequest): Promise<InboundEvent[]> {
    const body = JSON.parse(req.rawBody) as MetaWebhookPayload;
    const events: InboundEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const msg of value.messages ?? []) {
          const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "";
          events.push({
            kind: "Message",
            externalId: msg.id,
            customerIdentifier: msg.from,
            text,
            occurredAt: new Date(Number(msg.timestamp) * 1000).toISOString(),
            phoneNumberId: value.metadata?.phone_number_id,
          });
        }
        for (const status of value.statuses ?? []) {
          events.push({
            kind: "StatusUpdate",
            externalId: status.id,
            statusForExternalId: status.id,
            status: mapMetaStatus(status.status),
            occurredAt: new Date(Number(status.timestamp) * 1000).toISOString(),
          });
        }
      }
    }
    return events;
  },

  /**
   * FR-META-01's quick-reply -> interactive-button mapping, respecting Meta's
   * platform limits (seeded per `channel_capability`: `maxQuickReplies` = 3,
   * `maxButtonLabelChars` = 20, `maxTextChars` = 4096). Never fails the render —
   * over-limit input is truncated/paginated, exactly as the spec requires.
   */
  render(message: GenericMessagePayload, capabilities: ChannelCapability): OutboundPayload[] {
    if (message.contentType === "QuickReply" && message.chips && capabilities.supportsQuickReplies) {
      const maxButtons = capabilities.maxQuickReplies ?? message.chips.length;
      const maxLabel = capabilities.maxButtonLabelChars ?? Infinity;
      const truncateLabel = (label: string) => (label.length > maxLabel ? `${label.slice(0, maxLabel - 1)}…` : label);

      const payloads: OutboundPayload[] = [];
      const primary = message.chips.slice(0, maxButtons);
      payloads.push({
        kind: "interactive-buttons",
        text: message.text,
        buttons: primary.map((c) => ({ id: c.id, label: truncateLabel(c.label) })),
      });

      // Pagination: WhatsApp's own list-message type holds far more rows than the
      // 3-button interactive limit — the remaining chips become a follow-up list
      // message rather than being silently dropped (FR-META-01: "truncated/
      // paginated ... rather than failing to send").
      const overflow = message.chips.slice(maxButtons);
      if (overflow.length > 0) {
        payloads.push({
          kind: "interactive-list",
          text: "More options",
          buttons: overflow.map((c) => ({ id: c.id, label: truncateLabel(c.label) })),
        });
      }
      return payloads;
    }

    // Generic text: paginate into `maxTextChars`-sized chunks rather than failing
    // to send a message that exceeds WhatsApp's limit.
    const text = message.text ?? "";
    const maxChars = capabilities.maxTextChars ?? text.length;
    if (text.length <= maxChars || maxChars <= 0) {
      return [{ kind: "text", text }];
    }
    const chunks: OutboundPayload[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({ kind: "text", text: text.slice(i, i + maxChars) });
    }
    return chunks;
  },

  /**
   * FR-META-01's core enforcement point: a send outside the 24h customer-initiated
   * session window without an approved template is **rejected before send** — never
   * silently dropped, never downgraded to another channel. Throws
   * {@link WhatsAppTemplateRequiredError} (exact spec copy,
   * `WHATSAPP_TEMPLATE_REQUIRED_MESSAGE`) rather than calling Meta's API at all.
   */
  async send(payload: OutboundPayload, channel: ChannelDto, opts: unknown): Promise<SendReceipt> {
    const options = opts as WhatsAppSendOptions;
    const windowOpen = isWithinSessionWindow(options.lastInboundAt);
    if (!windowOpen && !options.approvedTemplate) {
      throw new WhatsAppTemplateRequiredError();
    }

    const client = (options.graphClientFactory ?? createMetaGraphClient)({
      accessToken: options.accessToken,
      baseUrl: options.graphApiBaseUrl,
    });

    const body = options.approvedTemplate
      ? {
          to: options.to,
          type: "template",
          template: {
            name: options.approvedTemplate.name,
            language: { code: options.approvedTemplate.language },
            components: options.approvedTemplate.variables
              ? [{ type: "body", parameters: options.approvedTemplate.variables.map((v) => ({ type: "text", text: v })) }]
              : undefined,
          },
        }
      : toGraphMessageBody(payload, options.to);

    const result = await client.sendMessage(options.phoneNumberId, body);
    const firstMessage = result.messages[0];
    if (!firstMessage) {
      throw new Error("Meta Graph API returned no message id for a send that reported success.");
    }
    return { externalMessageId: firstMessage.id };
  },

  validateConfig(config: unknown): ValidationResult {
    const errors: string[] = [];
    if (typeof config !== "object" || config === null) {
      return { valid: false, errors: ["Config must be an object."] };
    }
    const cfg = config as Record<string, unknown>;
    if (cfg.wabaId !== undefined && typeof cfg.wabaId !== "string") errors.push("wabaId must be a string.");
    return { valid: errors.length === 0, errors };
  },
};

/** FR-META-01: "24 hours" measured from the customer's *last inbound* message —
 * `null` (no inbound ever recorded) means the window has never opened, so a
 * template is required for the very first outbound send too (never assume an open
 * window by default — fail closed, consistent with LLD §11 rule 6). */
export function isWithinSessionWindow(lastInboundAt: string | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const elapsedMs = now.getTime() - new Date(lastInboundAt).getTime();
  return elapsedMs <= WHATSAPP_SESSION_WINDOW_HOURS * 60 * 60 * 1000;
}

function toGraphMessageBody(payload: OutboundPayload, to: string): Record<string, unknown> {
  if (payload.kind === "interactive-buttons") {
    return {
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: payload.text ?? "" },
        action: { buttons: (payload.buttons ?? []).map((b) => ({ type: "reply", reply: { id: b.id, title: b.label } })) },
      },
    };
  }
  if (payload.kind === "interactive-list") {
    return {
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: payload.text ?? "" },
        action: {
          button: "More options",
          sections: [{ title: "Options", rows: (payload.buttons ?? []).map((b) => ({ id: b.id, title: b.label })) }],
        },
      },
    };
  }
  return { to, type: "text", text: { body: payload.text ?? "" } };
}

function mapMetaStatus(status: string): "Sent" | "Delivered" | "Read" | "Failed" {
  switch (status) {
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    default:
      return "Failed";
  }
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          id: string;
          from: string;
          timestamp: string;
          text?: { body: string };
          button?: { text: string };
          interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
        }>;
        statuses?: Array<{ id: string; status: string; timestamp: string }>;
      };
    }>;
  }>;
}

export { WHATSAPP_TEMPLATE_REQUIRED_MESSAGE };
