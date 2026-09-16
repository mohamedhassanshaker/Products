/**
 * `MetaCloudWhatsAppTransport` — the real `ChannelTransport` adapter for WhatsApp
 * (api.md §9.11). Tenant-scoped: constructed once the inbound webhook (or a campaign send)
 * has already resolved which tenant's `WhatsAppConfig` applies, and every method below
 * assumes `getTenantDb()`/`getTenantCache()` already resolve against that tenant's ambient
 * context.
 *
 * "The session-window and opt-in checks live inside `send()`, not in the caller" (api.md
 * §9.11) — enforced here, so a human agent's reply, a campaign send and an assistant turn
 * all share the one guarantee regardless of which caller forgets to check first.
 */
import { getTenantCache } from "../../../../platform/adapters/outbound/cache/tenant-cache.js";
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import {
  OptInMissingError,
  SessionWindowClosedError,
  type ChannelCapabilities,
  type ChannelTransport,
  type DeliveryReceipt,
  type IdempotencyKey,
  type InboundEvent,
  type OutboundMessage,
  type RecipientRef,
  type SessionWindowState,
  type TemplateSend,
} from "../../../ports/channel-transport.js";

const SESSION_WINDOW_KEY_PREFIX = "wa:window:";
const SESSION_WINDOW_TTL_SECONDS = 24 * 60 * 60;

export interface MetaCloudWhatsAppTransportConfig {
  readonly phoneNumberId: string;
  readonly optInRequired: boolean;
  /** `env:NAME` — resolved from `process.env` (this project's own reference convention,
   *  `CK_WhatsAppConfigs_secretIsReference`). No secrets-manager adapter exists in this
   *  codebase yet beyond the `env:` scheme, so that is the one this transport resolves. */
  readonly credentialSecretRef: string;
  readonly graphApiBaseUrl?: string;
}

function resolveEnvSecret(ref: string): string {
  if (!ref.startsWith("env:")) {
    throw new Error(
      `Unsupported secret reference scheme: "${ref}" (only "env:" is resolvable in this pass).`,
    );
  }
  const name = ref.slice("env:".length);
  const value = process.env[name];
  if (!value) throw new Error(`Secret reference "${ref}" is not set in the environment.`);
  return value;
}

export class MetaCloudWhatsAppTransport implements ChannelTransport {
  readonly channel = "WhatsApp" as const;

  constructor(private readonly config: MetaCloudWhatsAppTransportConfig) {}

  capabilities(): ChannelCapabilities {
    return {
      supportsChips: false,
      // WhatsApp renders suggestion chips as an interactive list message (A1 rule,
      // FR-CHAN-20) — capability reported here so the domain never branches on channel.
      supportsListMessage: true,
      supportsRichMedia: true,
      requiresOptIn: this.config.optInRequired,
      sessionWindowHours: 24,
      maxMessageLength: 4096,
    };
  }

  private windowKey(waId: string): string {
    return `${SESSION_WINDOW_KEY_PREFIX}${waId}`;
  }

  /** Called on every real inbound message — opens/refreshes the 24-hour window. */
  async markSessionWindowOpen(waId: string): Promise<void> {
    await getTenantCache().set(this.windowKey(waId), "1", SESSION_WINDOW_TTL_SECONDS);
  }

  async sessionState(recipient: RecipientRef): Promise<SessionWindowState> {
    const ttl = await getTenantCache().ttl(this.windowKey(recipient.address));
    if (ttl <= 0) return { isOpen: false, expiresAt: null };
    return { isOpen: true, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  private async assertOptedIn(waId: string): Promise<void> {
    if (!this.config.optInRequired) return;
    const state = await getTenantDb().consentState.findUnique({
      where: {
        subjectHash_channelKey_purpose: {
          subjectHash: waId,
          channelKey: "WhatsApp",
          purpose: "ProactiveMessaging",
        },
      },
    });
    if (!state || state.state !== "OptedIn") throw new OptInMissingError();
  }

  private async callGraphApi(
    phoneNumberId: string,
    body: unknown,
  ): Promise<{ readonly messageId: string | null }> {
    const accessToken = resolveEnvSecret(this.config.credentialSecretRef);
    const base = this.config.graphApiBaseUrl ?? "https://graph.facebook.com/v20.0";
    const response = await fetch(`${base}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Meta Cloud API send failed (${String(response.status)}): ${detail}`);
    }
    const json = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
    } | null;
    return { messageId: json?.messages?.[0]?.id ?? null };
  }

  async send(message: OutboundMessage, _key: IdempotencyKey): Promise<DeliveryReceipt> {
    void _key; // real idempotency is CampaignSend's unique constraint / the caller's own dedupe; nothing to re-check here.
    const waId = message.recipient.address;
    await this.assertOptedIn(waId);

    const state = await this.sessionState(message.recipient);
    if (!state.isOpen) {
      // "A closed window throws SessionWindowClosed -> 409 conversation.session_window_closed"
      // (api.md §9.11) — the one exception is a template send, which is the dedicated method
      // below and never reaches this branch.
      throw new SessionWindowClosedError();
    }

    const body =
      message.suggestions.length > 0
        ? {
            messaging_product: "whatsapp",
            to: waId,
            type: "interactive",
            interactive: {
              type: "list",
              body: { text: message.text },
              action: {
                button: "Choose",
                sections: [
                  {
                    rows: message.suggestions.map((chip) => ({
                      id: chip.id,
                      title: chip.label.slice(0, 24),
                    })),
                  },
                ],
              },
            },
          }
        : { messaging_product: "whatsapp", to: waId, type: "text", text: { body: message.text } };

    const { messageId } = await this.callGraphApi(this.config.phoneNumberId, body);
    return { providerMessageId: messageId, acceptedAt: new Date() };
  }

  async sendTemplate(send: TemplateSend, _key: IdempotencyKey): Promise<DeliveryReceipt> {
    void _key;
    // Deliberately NO session-window check: a template send is "the only way to open a
    // closed WhatsApp session window" (api.md §9.11) — gating it on the window would make
    // the one recovery path unreachable exactly when it is needed.
    const body = {
      messaging_product: "whatsapp",
      to: send.recipient.address,
      type: "template",
      template: {
        name: send.templateBspId,
        language: { code: "en" },
        components:
          send.variables.length > 0
            ? [
                {
                  type: "body",
                  parameters: send.variables.map((value) => ({ type: "text", text: value })),
                },
              ]
            : [],
      },
    };
    const { messageId } = await this.callGraphApi(this.config.phoneNumberId, body);
    return { providerMessageId: messageId, acceptedAt: new Date() };
  }

  /**
   * Normalises Meta's real webhook JSON shape into domain `InboundEvent`s. Structural
   * parsing only — no side effects, no consent/session-window bookkeeping (that is the
   * webhook route's own orchestration, since it spans multiple modules: `ConsentRepository`,
   * `MessageTemplateRepository`, this transport's own `markSessionWindowOpen`).
   */
  async parseInbound(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string | undefined>>,
  ): Promise<readonly InboundEvent[]> {
    void _headers;
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    } catch {
      return [];
    }
    return parseMetaWebhookPayload(payload);
  }
}

interface MetaWebhookPayload {
  readonly entry?: readonly {
    readonly changes?: readonly {
      readonly value?: {
        readonly messages?: readonly {
          readonly from?: string;
          readonly id?: string;
          readonly timestamp?: string;
          readonly type?: string;
          readonly text?: { readonly body?: string };
          readonly interactive?: { readonly list_reply?: { readonly id?: string } };
        }[];
        readonly statuses?: readonly {
          readonly id?: string;
          readonly status?: string;
          readonly timestamp?: string;
        }[];
        readonly message_template_status_update?: {
          readonly message_template_id?: string;
          readonly event?: string;
          readonly reason?: string;
        };
      };
    }[];
  }[];
}

const DELIVERY_STATUS_MAP: Readonly<Record<string, "sent" | "delivered" | "read" | "failed">> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/** Exported for direct unit testing without constructing a transport instance. */
export function parseMetaWebhookPayload(payload: unknown): readonly InboundEvent[] {
  const events: InboundEvent[] = [];
  if (typeof payload !== "object" || payload === null) return events;
  const typed = payload as MetaWebhookPayload;

  for (const entry of typed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const message of value.messages ?? []) {
        const occurredAt = message.timestamp
          ? new Date(Number(message.timestamp) * 1000)
          : new Date();
        const from = message.from;
        const messageId = message.id;
        if (!from || !messageId) continue;

        const listReplyId = message.interactive?.list_reply?.id;
        if (listReplyId) {
          events.push({
            kind: "list_reply",
            from: { address: from },
            chipId: listReplyId,
            messageId,
            occurredAt,
          });
        } else {
          events.push({
            kind: "message",
            from: { address: from },
            text: message.text?.body ?? "",
            messageId,
            occurredAt,
          });
        }
      }

      for (const status of value.statuses ?? []) {
        const mapped = status.status ? DELIVERY_STATUS_MAP[status.status] : undefined;
        if (!status.id || !mapped) continue;
        events.push({
          kind: "delivery_receipt",
          providerMessageId: status.id,
          status: mapped,
          occurredAt: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
        });
      }

      const templateUpdate = value.message_template_status_update;
      if (templateUpdate?.message_template_id && templateUpdate.event) {
        const approved = templateUpdate.event.toUpperCase() === "APPROVED";
        const rejected = templateUpdate.event.toUpperCase() === "REJECTED";
        if (approved || rejected) {
          events.push({
            kind: "template_status_changed",
            bspTemplateId: templateUpdate.message_template_id,
            status: approved ? "approved" : "rejected",
            rejectionReason: templateUpdate.reason ?? null,
            occurredAt: new Date(),
          });
        }
      }
    }
  }

  return events;
}
