import { Type, type Static } from "@sinclair/typebox";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — outbound webhooks.
 *
 * `WebhookEventCategory` is the tenant-facing vocabulary FR-API-02 names verbatim —
 * never an internal `domain_event.type` string (see
 * `packages/modules/webhooks/src/domain/event-category.ts`'s mapping table, which is
 * the only place that vocabulary is allowed to leak across).
 */
export const WebhookEventCategory = Type.Union([
  Type.Literal("EscalationCreated"),
  Type.Literal("ApprovalPending"),
  Type.Literal("GuardrailTripped"),
  Type.Literal("DeploymentChanged"),
  Type.Literal("DriftDetected"),
]);
export type WebhookEventCategoryValue = Static<typeof WebhookEventCategory>;

export const CreateWebhookSubscriptionRequestSchema = Type.Object(
  {
    targetUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    eventCategories: Type.Array(WebhookEventCategory, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type CreateWebhookSubscriptionRequest = Static<typeof CreateWebhookSubscriptionRequestSchema>;

export const UpdateWebhookSubscriptionRequestSchema = Type.Object(
  {
    targetUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    eventCategories: Type.Optional(Type.Array(WebhookEventCategory, { minItems: 1 })),
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UpdateWebhookSubscriptionRequest = Static<typeof UpdateWebhookSubscriptionRequestSchema>;

/** The full key returned exactly once at creation, matching the service-account API
 * key convention (`IssueApiKeyRequest`'s own sibling) — only the signing secret's
 * envelope-encrypted form is ever persisted; the plaintext is never retrievable again
 * after this response. */
export const WebhookSubscriptionCreatedResponseSchema = Type.Object({
  id: Type.String(),
  targetUrl: Type.String(),
  eventCategories: Type.Array(WebhookEventCategory),
  signingSecret: Type.String(),
  enabled: Type.Boolean(),
});
export type WebhookSubscriptionCreatedResponse = Static<typeof WebhookSubscriptionCreatedResponseSchema>;
