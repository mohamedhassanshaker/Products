import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { MessagePayloadSchema, MessageContentTypeSchema } from "./messages.js";
import type { MessageSenderSchema } from "./messages.js";
import type { ChannelCapabilitySchema, WebWidgetConfigSchema } from "./channels.js";

export const ConversationStatusSchema = Type.Union([
  Type.Literal("Active"),
  Type.Literal("Resolved"),
  Type.Literal("Escalated"),
  Type.Literal("Abandoned"),
]);
export type ConversationStatusValue = Static<typeof ConversationStatusSchema>;

export const ResolutionTypeSchema = Type.Union([
  Type.Literal("AI"),
  Type.Literal("Human"),
  Type.Literal("Abandoned"),
]);
export type ResolutionTypeValue = Static<typeof ResolutionTypeSchema>;

export const DeliveryStatusSchema = Type.Union([
  Type.Literal("Pending"),
  Type.Literal("Sent"),
  Type.Literal("Delivered"),
  Type.Literal("Read"),
  Type.Literal("Failed"),
]);
export type DeliveryStatusValue = Static<typeof DeliveryStatusSchema>;

// ---------------------------------------------------------------------------
// LLD §5.3 — widget <-> backend real-time channel (BL-04)
// ---------------------------------------------------------------------------

export const CreateWidgetSessionRequestSchema = Type.Object({
  tenantSlug: Type.String({ minLength: 1 }),
  channelPublicKey: Type.String({ minLength: 1 }),
  language: Type.Optional(Type.String()),
  customerIdentifier: Type.Optional(Type.String()),
  customerAuthToken: Type.Optional(Type.String()),
  metadata: Type.Optional(
    Type.Object({
      pageUrl: Type.Optional(Type.String()),
      referrer: Type.Optional(Type.String()),
      userAgent: Type.Optional(Type.String()),
    }),
  ),
  /** Present when the widget already holds a session (e.g. page reload) and wants to
   * resume the same conversation rather than start a new one. */
  resumeSessionToken: Type.Optional(Type.String()),
  /**
   * Phase 6 (client-feedback-batch item 9) sandbox-preview override — the specific
   * `agent_definition_version` id an Admin Console operator wants to test before
   * promoting it. **Never trust this field on its own**: it is only ever honored by
   * `createWidgetSession` when paired with a `previewToken` that independently
   * verifies (via `@nextbot/iam`'s `verifySandboxPreviewToken`, checked by the
   * Gateway Plane composition root — `apps/gateway`'s `POST /widget/sessions` route,
   * since `conversations` has no allowed dependency on `iam`, LLD §2.3) that the
   * caller holds a real, unexpired Admin Console session with `agent_platform: Write`
   * scoped to this exact version id. A plain anonymous widget embed on a real
   * customer's page setting this field alone gets it rejected outright, never
   * silently ignored-with-fallback — see `createWidgetSession`'s doc comment.
   */
  previewVersionId: Type.Optional(Type.String()),
  /** The signed, short-lived token proving admin authorization for `previewVersionId`
   * above (see its doc). Required whenever `previewVersionId` is present. */
  previewToken: Type.Optional(Type.String()),
});
export type CreateWidgetSessionRequest = Static<typeof CreateWidgetSessionRequestSchema>;

export interface CreateWidgetSessionResult {
  sessionToken: string;
  conversationId: string;
  channel: {
    capabilities: Static<typeof ChannelCapabilitySchema>;
    config: Static<typeof WebWidgetConfigSchema>;
    languages: string[];
    /** FR-ADM-07: true when the tenant's `white_label_enabled` flag is set — the
     * widget's "Powered by NextBot" footer must not render. */
    hidePoweredBy: boolean;
  };
  resumeFromSequence: number;
}

export const SendWidgetMessageRequestSchema = Type.Object({
  clientMessageId: Type.String({ minLength: 1, maxLength: 100 }),
  contentType: MessageContentTypeSchema,
  payload: MessagePayloadSchema,
  replyToMessageId: Type.Optional(Type.String()),
});
export type SendWidgetMessageRequest = Static<typeof SendWidgetMessageRequestSchema>;

export interface SendWidgetMessageResult {
  messageId: string;
  sequence: number;
  acceptedAt: string;
  runId: string;
}

export const WidgetTypingRequestSchema = Type.Object({
  state: Type.Union([Type.Literal("start"), Type.Literal("stop")]),
});
export type WidgetTypingRequest = Static<typeof WidgetTypingRequestSchema>;

export const WidgetLanguageRequestSchema = Type.Object({
  language: Type.String({ minLength: 2 }),
});
export type WidgetLanguageRequest = Static<typeof WidgetLanguageRequestSchema>;

// ---------------------------------------------------------------------------
// U6 fix (QA fix pass) — Conversation List bulk actions (screen inventory B.4.1)
// ---------------------------------------------------------------------------

/** `PATCH /api/v1/admin/conversations/bulk` request body — applies `tag` (adds a
 * label to `conversation.metadata.tags`) or `archive` (sets
 * `conversation.metadata.archived`/`archivedAt`) to every id in `conversationIds` in
 * one tenant-scoped batch. Capped at 200 ids per request server-side (defense against
 * an unbounded batch update). */
export const BulkConversationActionRequestSchema = Type.Object({
  conversationIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
  action: Type.Union([Type.Literal("tag"), Type.Literal("archive")]),
  /** Required (and validated non-empty) when `action === "tag"`; ignored otherwise. */
  tag: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
});
export type BulkConversationActionRequest = Static<typeof BulkConversationActionRequestSchema>;

// ---------------------------------------------------------------------------
// Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel identity
// resolution
// ---------------------------------------------------------------------------

/** `PATCH /api/v1/admin/conversations/:id/customer-identifier` request body — an
 * admin/agent recording a customer identifier they have confirmed during a live
 * conversation (the human-verification moment FR-OC-08's own "verified phone number"
 * example describes — see this endpoint's route handler doc for why no cryptographic
 * OTP-style verification mechanism exists in this codebase). Always recomputes
 * `customer_identifier_hash` alongside the raw value. */
export const SetConversationCustomerIdentifierRequestSchema = Type.Object({
  customerIdentifier: Type.String({ minLength: 1, maxLength: 320 }),
});
export type SetConversationCustomerIdentifierRequest = Static<typeof SetConversationCustomerIdentifierRequestSchema>;

/** `PATCH /api/v1/admin/settings/identity-resolution-policy` request body — the
 * tenant-opt-in toggle itself (OFF by default, FR-OC-08's hard requirement). */
export const SetIdentityResolutionPolicyRequestSchema = Type.Object({
  enabled: Type.Boolean(),
});
export type SetIdentityResolutionPolicyRequest = Static<typeof SetIdentityResolutionPolicyRequestSchema>;

/** Shape of every `message` SSE event's `MessageDto` (LLD §5.3). */
export interface MessageDto {
  id: string;
  conversationId: string;
  sequence: number;
  sender: Static<typeof MessageSenderSchema>;
  contentType: Static<typeof MessageContentTypeSchema>;
  payload: unknown;
  confidenceScore: number | null;
  createdAt: string;
  /** D6 fix (QA fix pass): present only for `sender === "Customer"` messages —
   * carries the same client-generated id the widget used when it sent this
   * message. Without this, the widget frontend had no race-proof key to dedup its
   * own optimistic local bubble against the SSE echo of that same message: the
   * echo can arrive *before* the HTTP response that reconciles the bubble's real
   * server `id`, so matching on `id` alone let the customer's own message render
   * twice under that ordering. */
  clientMessageId?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WidgetSessionInvalidError extends DomainError {
  readonly code = "WIDGET_SESSION_INVALID";
  readonly httpStatus = 401;
  constructor() {
    super("Your chat session has expired. Please refresh the page.");
  }
}

/**
 * Phase 6 (client-feedback-batch item 9): raised whenever a widget session request
 * carries `previewVersionId` without a `previewToken` that independently verifies as
 * a genuine, unexpired Admin Console `agent_platform: Write` authorization scoped to
 * that exact version — missing token, tampered/expired token, or a token issued for a
 * *different* version/tenant all collapse to this same 403, deliberately fail-closed
 * (never a silent fallback to an ordinary anonymous session, which would let the
 * override be dropped quietly instead of rejected — the failure mode this project's
 * own conventions explicitly flag). 403 (not 401): the caller is a genuinely
 * anonymous widget session either way: this isn't "your session expired," it's "this
 * specific privileged action is not authorized."
 */
export class SandboxPreviewInvalidError extends DomainError {
  readonly code = "SANDBOX_PREVIEW_INVALID";
  readonly httpStatus = 403;
  constructor() {
    super("Sandbox preview is not authorized for this request.");
  }
}

export class MessagePayloadInvalidError extends DomainError {
  readonly code = "MESSAGE_PAYLOAD_INVALID";
  readonly httpStatus = 422;
  constructor(detail?: string) {
    super(detail ?? "That message could not be sent — its content did not match the expected format.");
  }
}

/** FR-OC-01: missing `tenantId`/`channelId` — the widget itself fails closed
 * client-side before any request is made (`NEXTBOT_INIT_ERROR`); this error type
 * exists for the (defense-in-depth) server-side equivalent when a request somehow
 * arrives without them anyway. */
export class WidgetInitError extends DomainError {
  readonly code = "WIDGET_INIT_ERROR";
  readonly httpStatus = 422;
  constructor(field: string) {
    super(`${field} is required.`);
  }
}
