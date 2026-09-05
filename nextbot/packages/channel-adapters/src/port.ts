/**
 * The `ChannelAdapter` port (LLD §8) — the one interface every channel
 * implementation satisfies. `registry.ts` is "the only switch in the codebase"
 * mapping a `ChannelType` to its adapter; adding a channel means adding one folder +
 * one registry entry + one seeded `channel_capability` row, never a core change.
 */

/** A minimal, framework-free stand-in for an inbound HTTP request — deliberately not
 * `Request`/`NextRequest` (this package must stay framework-free per LLD §2.2's
 * "packages/* stay dependency-light" convention, and to keep every adapter testable
 * without spinning up Next.js). The composition root (`apps/gateway`) adapts a real
 * `NextRequest` into this shape at the one call site that needs it. */
export interface RawRequest {
  /** Raw, unparsed body — required for HMAC signature verification, which must run
   * against the exact bytes Meta/GitHub signed, not a re-serialized JSON.parse output. */
  rawBody: string;
  headers: Record<string, string | null>;
  /** Query string params (used by WhatsApp's `hub.challenge` GET verification handshake). */
  query: Record<string, string | null>;
}

/** A minimally-typed channel row — just enough for an adapter to do its job without
 * depending on `@nextbot/db`'s `ChannelRow` (this package stays DB-agnostic). */
export interface ChannelDto {
  id: string;
  tenantId: string;
  type: string;
  config: Record<string, unknown>;
}

export type InboundEventKind = "Message" | "StatusUpdate";

/** One parsed inbound event — a customer message or a delivery/read status callback.
 * `parseInbound` can return several from one webhook delivery (Meta batches). */
export interface InboundEvent {
  kind: InboundEventKind;
  /** Provider's own event/message id — used as `message.clientMessageId` so this
   * codebase's existing per-conversation unique-index idempotency (LLD §5.3) covers
   * webhook redelivery for free, with no bespoke dedup table. */
  externalId: string;
  /** Present for `Message` events. */
  customerIdentifier?: string;
  text?: string;
  /** Present for `StatusUpdate` events: the externalId of the outbound message this
   * status applies to, and the new delivery status. */
  statusForExternalId?: string;
  status?: "Sent" | "Delivered" | "Read" | "Failed";
  occurredAt: string;
  /** WhatsApp only: the receiving business phone-number-id this event arrived on —
   * needed to resolve which `whatsapp_number` (and therefore which credentials) the
   * reply should send from, since a tenant may register more than one number. */
  phoneNumberId?: string;
}

/** Generic content payload an adapter is asked to render/send — intentionally a
 * loose shape (not `@nextbot/contracts`' `MessagePayload` union) so this package
 * never depends on `@nextbot/contracts` (kept dependency-free, LLD §2.2). The
 * composition root maps the real `MessagePayload` into this shape. */
export interface GenericMessagePayload {
  contentType: "Text" | "QuickReply" | "List" | "Other";
  text?: string;
  chips?: Array<{ id: string; label: string }>;
}

/** What `render()` produces — channel-native, ready-to-send payload(s); more than one
 * when a single generic message must be paginated to fit the channel's limits. */
export interface OutboundPayload {
  kind: "text" | "interactive-buttons" | "interactive-list";
  text?: string;
  buttons?: Array<{ id: string; label: string }>;
}

export interface ChannelCapability {
  supportsRichCards: boolean;
  supportsQuickReplies: boolean;
  maxQuickReplies: number | null;
  maxButtonLabelChars: number | null;
  maxTextChars: number | null;
}

export interface SendReceipt {
  externalMessageId: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Runtime, already-decrypted send context — resolved by the composition root
 * (`apps/gateway`, ADR-0004's confinement of credential decryption to the Gateway
 * Plane) immediately before calling `send()`. Never persisted, never logged. */
export interface WhatsAppSendCredentials {
  accessToken: string;
  phoneNumberId: string;
  graphApiBaseUrl?: string;
}

export interface ChannelAdapter {
  readonly type: string;
  verifyWebhook(req: RawRequest, channel: ChannelDto, secret: string): Promise<boolean>;
  /** WhatsApp/Meta's GET subscription handshake — `null` for channels with no such
   * handshake (most). Returns the `hub.challenge` value to echo back, or `null` if
   * the request's `hub.verify_token` didn't match. */
  verifySubscription?(req: RawRequest, verifyToken: string): string | null;
  parseInbound(req: RawRequest, channel: ChannelDto): Promise<InboundEvent[]>;
  render(message: GenericMessagePayload, capabilities: ChannelCapability): OutboundPayload[];
  send(payload: OutboundPayload, channel: ChannelDto, opts: unknown): Promise<SendReceipt>;
  validateConfig(config: unknown): ValidationResult;
}
