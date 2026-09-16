import type { ChannelKey } from "../domain/vocabulary.js";

/** api.md §9.11's `ChannelTransport` — the one seam through which "channel adaptation is
 *  structural, not cosmetic" (A1 rule) is actually implemented. The domain emits one
 *  `OutboundMessage` and never branches on channel; each transport renders it into that
 *  channel's native form. */

export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };

export function idempotencyKeyOf(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}

export interface RecipientRef {
  /** The channel-native address — a WhatsApp `waId` (E.164, no `+`), a web session id. */
  readonly address: string;
}

export interface SuggestionChip {
  readonly id: string;
  readonly label: string;
}

/** One domain message, rendered per-channel by the transport (`send()`'s own job) — never
 *  branched on by a caller. `kind` distinguishes a live reply from a proactive send, so
 *  quiet hours can apply to one and not the other (api.md §10.3's own `[ASSUMPTION]`). */
export interface OutboundMessage {
  readonly kind: "reactive" | "proactive";
  readonly recipient: RecipientRef;
  readonly text: string;
  readonly suggestions: readonly SuggestionChip[];
}

export interface TemplateSend {
  readonly recipient: RecipientRef;
  readonly templateBspId: string;
  readonly variables: readonly string[];
}

export interface DeliveryReceipt {
  readonly providerMessageId: string | null;
  readonly acceptedAt: Date;
}

export interface SessionWindowState {
  readonly isOpen: boolean;
  readonly expiresAt: Date | null;
}

export interface ChannelCapabilities {
  readonly supportsChips: boolean;
  readonly supportsListMessage: boolean;
  readonly supportsRichMedia: boolean;
  readonly requiresOptIn: boolean;
  readonly sessionWindowHours: number | null;
  readonly maxMessageLength: number;
}

export type InboundEvent =
  | {
      readonly kind: "message";
      readonly from: RecipientRef;
      readonly text: string;
      readonly messageId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: "list_reply";
      readonly from: RecipientRef;
      readonly chipId: string;
      readonly messageId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: "delivery_receipt";
      readonly providerMessageId: string;
      readonly status: "sent" | "delivered" | "read" | "failed";
      readonly occurredAt: Date;
    }
  | {
      readonly kind: "template_status_changed";
      readonly bspTemplateId: string;
      readonly status: "approved" | "rejected";
      readonly rejectionReason: string | null;
      readonly occurredAt: Date;
    }
  | { readonly kind: "unrecognised"; readonly raw: string };

/** Thrown by `send()`/`sendTemplate()` when the 24-hour session window is closed and no
 *  template send was offered instead — `409 conversation.session_window_closed`
 *  (api.md §9.11, §10.1 rule 6). The session-window check lives INSIDE `send()`, not in any
 *  caller, so a human agent's reply, a campaign send and an assistant turn all share the same
 *  guarantee. */
export class SessionWindowClosedError extends Error {
  constructor(readonly requiredTemplate: true = true) {
    super("The 24-hour session window is closed; a template send is required to re-open it.");
    this.name = "SessionWindowClosedError";
  }
}

/** Thrown by `send()` when the recipient has no current, recorded opt-in and the channel
 *  requires one (`WhatsAppConfig.optInRequired`). */
export class OptInMissingError extends Error {
  constructor() {
    super("The recipient has no current, recorded opt-in for this channel.");
    this.name = "OptInMissingError";
  }
}

export interface ChannelTransport {
  readonly channel: ChannelKey;
  send(message: OutboundMessage, key: IdempotencyKey): Promise<DeliveryReceipt>;
  sendTemplate(send: TemplateSend, key: IdempotencyKey): Promise<DeliveryReceipt>;
  parseInbound(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<readonly InboundEvent[]>;
  sessionState(recipient: RecipientRef): Promise<SessionWindowState>;
  capabilities(): ChannelCapabilities;
}

/** Registered channels with no real adapter yet (Mobile app, Kiosk/IVR — B10 tab 1 shows
 *  both `Disabled` with no bound agent). Selecting them is a real, honest `501`, never a
 *  pretend success (api.md §9.11). */
export class AdapterNotImplementedError extends Error {
  constructor(readonly channel: ChannelKey) {
    super(`No transport adapter is registered for channel "${channel}".`);
    this.name = "AdapterNotImplementedError";
  }
}
