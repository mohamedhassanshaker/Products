import { Type, type Static } from '@sinclair/typebox';

/**
 * `hitl` module wire contracts (Phase 14, BL-052..057 — `docs/v2/BACKLOG.md`;
 * `docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md` §A8;
 * `ARCHITECTURE_NOTES.md` §6/§8). Mirrors `skills/schemas.ts`'s shape:
 * full CRUD for the tenant-scoped `ReviewerGroup`/`HitlGate` aggregates,
 * plus the reviewer-console queue/decision endpoints.
 *
 * Per R-H1, a `HitlGate` has no partially-specified saved state — unlike
 * `Skill`/`SkillVersion`'s draft/published split, create/update requests
 * for a gate require all six mandatory fields together (this is enforced
 * both by this schema's requiredness and, defensively, by
 * `hitl-validation.ts`'s own structural check).
 */

export const HitlGateTypeSchema = Type.Union([
  Type.Literal('blocking'),
  Type.Literal('deferred'),
  Type.Literal('pre_speech'),
  Type.Literal('whisper'),
  Type.Literal('post_hoc'),
]);
export type HitlGateType = Static<typeof HitlGateTypeSchema>;

/** v1 (`docs/v2/UX_SCOPE.md`) only ever creates these three — `whisper`/`post_hoc` render disabled ("Coming soon"). */
export const SUPPORTED_HITL_GATE_TYPES: readonly HitlGateType[] = ['blocking', 'deferred', 'pre_speech'];

export const HitlAttachmentKindSchema = Type.Union([
  Type.Literal('tool'),
  Type.Literal('skill'),
  Type.Literal('graph_node'),
]);
export type HitlAttachmentKind = Static<typeof HitlAttachmentKindSchema>;

export const HitlTimeoutBehaviorSchema = Type.Union([
  Type.Literal('auto_approve'),
  Type.Literal('auto_deny'),
  Type.Literal('escalate'),
  Type.Literal('defer_to_async'),
]);
export type HitlTimeoutBehavior = Static<typeof HitlTimeoutBehaviorSchema>;

export const HitlGateStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('disabled')]);
export type HitlGateStatus = Static<typeof HitlGateStatusSchema>;

export const HitlDecisionStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('denied'),
  Type.Literal('edited_approved'),
  Type.Literal('timed_out'),
  Type.Literal('escalated'),
  Type.Literal('deferred'),
]);
export type HitlDecisionStatus = Static<typeof HitlDecisionStatusSchema>;

/** v1 ships in-app/email only (BL-056) — SMS is BL-077, permanently deferred. */
export const NotificationChannelTypeSchema = Type.Union([Type.Literal('in_app'), Type.Literal('email')]);
export type NotificationChannelType = Static<typeof NotificationChannelTypeSchema>;

export const NotificationChannelSchema = Type.Object({
  type: NotificationChannelTypeSchema,
  /** Required for `type: 'email'`; ignored for `in_app` (checked at the application layer, not the schema). */
  address: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
});
export type NotificationChannel = Static<typeof NotificationChannelSchema>;

const ReviewerGroupFields = {
  name: Type.String({ minLength: 1, maxLength: 80 }),
  members: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { default: [] }),
  notification_channels: Type.Array(NotificationChannelSchema, { default: [] }),
};

export const CreateReviewerGroupRequestSchema = Type.Object(
  {
    name: ReviewerGroupFields.name,
    members: Type.Optional(ReviewerGroupFields.members),
    notification_channels: Type.Optional(ReviewerGroupFields.notification_channels),
  },
  { additionalProperties: false },
);
export type CreateReviewerGroupRequest = Static<typeof CreateReviewerGroupRequestSchema>;

export const UpdateReviewerGroupRequestSchema = Type.Object(
  {
    name: Type.Optional(ReviewerGroupFields.name),
    members: Type.Optional(ReviewerGroupFields.members),
    notification_channels: Type.Optional(ReviewerGroupFields.notification_channels),
  },
  { additionalProperties: false },
);
export type UpdateReviewerGroupRequest = Static<typeof UpdateReviewerGroupRequestSchema>;

export const ReviewerGroupSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  members: Type.Array(Type.String()),
  notification_channels: Type.Array(NotificationChannelSchema),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type ReviewerGroupDto = Static<typeof ReviewerGroupSchema>;

export const ListReviewerGroupsResponseSchema = Type.Object({ items: Type.Array(ReviewerGroupSchema) });
export type ListReviewerGroupsResponseDto = Static<typeof ListReviewerGroupsResponseSchema>;

/** R-H1's six mandatory fields, plus what the gate is attached to. All required — see this file's top docstring. */
const HitlGateFields = {
  attachment_kind: HitlAttachmentKindSchema,
  attachment_ref: Type.String({ minLength: 1, maxLength: 128 }),
  trigger_condition: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
  gate_type: HitlGateTypeSchema,
  reviewer_group_id: Type.String({ format: 'uuid' }),
  sla_seconds: Type.Integer({ minimum: 1, maximum: 3600 }),
  hold_treatment_text: Type.String({ minLength: 1, maxLength: 500 }),
  timeout_behavior: HitlTimeoutBehaviorSchema,
  escalate_to_group_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  /** V-8's "written acknowledgement" — required by the application layer only when `timeout_behavior: 'auto_approve'` on a consequential-tool attachment. */
  auto_approve_ack_text: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 1000 }), Type.Null()])),
  notify_channels: Type.Array(NotificationChannelTypeSchema, { default: [] }),
  environments: Type.Array(Type.Union([Type.Literal('dev'), Type.Literal('staging'), Type.Literal('production')]), {
    default: ['dev', 'staging', 'production'],
  }),
  status: Type.Optional(HitlGateStatusSchema),
};

export const CreateHitlGateRequestSchema = Type.Object(
  {
    attachment_kind: HitlGateFields.attachment_kind,
    attachment_ref: HitlGateFields.attachment_ref,
    trigger_condition: Type.Optional(HitlGateFields.trigger_condition),
    gate_type: HitlGateFields.gate_type,
    reviewer_group_id: HitlGateFields.reviewer_group_id,
    sla_seconds: HitlGateFields.sla_seconds,
    hold_treatment_text: HitlGateFields.hold_treatment_text,
    timeout_behavior: HitlGateFields.timeout_behavior,
    escalate_to_group_id: HitlGateFields.escalate_to_group_id,
    auto_approve_ack_text: HitlGateFields.auto_approve_ack_text,
    notify_channels: Type.Optional(HitlGateFields.notify_channels),
    environments: Type.Optional(HitlGateFields.environments),
  },
  { additionalProperties: false },
);
export type CreateHitlGateRequest = Static<typeof CreateHitlGateRequestSchema>;

/** `PATCH` body — every field optional; a partial update is still validated whole against R-H1 once merged onto the existing row. */
export const UpdateHitlGateRequestSchema = Type.Object(
  {
    attachment_kind: Type.Optional(HitlGateFields.attachment_kind),
    attachment_ref: Type.Optional(HitlGateFields.attachment_ref),
    trigger_condition: Type.Optional(HitlGateFields.trigger_condition),
    gate_type: Type.Optional(HitlGateFields.gate_type),
    reviewer_group_id: Type.Optional(HitlGateFields.reviewer_group_id),
    sla_seconds: Type.Optional(HitlGateFields.sla_seconds),
    hold_treatment_text: Type.Optional(HitlGateFields.hold_treatment_text),
    timeout_behavior: Type.Optional(HitlGateFields.timeout_behavior),
    escalate_to_group_id: HitlGateFields.escalate_to_group_id,
    auto_approve_ack_text: HitlGateFields.auto_approve_ack_text,
    notify_channels: Type.Optional(HitlGateFields.notify_channels),
    environments: Type.Optional(HitlGateFields.environments),
    status: HitlGateFields.status,
  },
  { additionalProperties: false },
);
export type UpdateHitlGateRequest = Static<typeof UpdateHitlGateRequestSchema>;

export const HitlGateSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  attachment_kind: HitlAttachmentKindSchema,
  attachment_ref: Type.String(),
  trigger_condition: Type.Record(Type.String(), Type.Unknown()),
  gate_type: HitlGateTypeSchema,
  reviewer_group_id: Type.String({ format: 'uuid' }),
  sla_seconds: Type.Integer(),
  hold_treatment_text: Type.String(),
  timeout_behavior: HitlTimeoutBehaviorSchema,
  escalate_to_group_id: Type.Union([Type.String(), Type.Null()]),
  auto_approve_ack_text: Type.Union([Type.String(), Type.Null()]),
  notify_channels: Type.Array(NotificationChannelTypeSchema),
  environments: Type.Array(Type.String()),
  status: HitlGateStatusSchema,
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type HitlGateDto = Static<typeof HitlGateSchema>;

export const ListHitlGatesResponseSchema = Type.Object({ items: Type.Array(HitlGateSchema) });
export type ListHitlGatesResponseDto = Static<typeof ListHitlGatesResponseSchema>;

/** R-H6 — the reviewer's full context: transcript so far, proposed action, caller identity, retrieved sources, model's stated reasoning. */
export const HitlProposedActionSchema = Type.Object({
  kind: Type.Union([Type.Literal('tool_call'), Type.Literal('spoken_text')]),
  summary: Type.String({ maxLength: 2000 }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  transcript_excerpt: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
  caller_identity: Type.Optional(Type.String({ maxLength: 200 })),
  retrieved_sources: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
  model_reasoning: Type.Optional(Type.String({ maxLength: 4000 })),
});
export type HitlProposedAction = Static<typeof HitlProposedActionSchema>;

export const HitlDecisionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  session_id: Type.String({ format: 'uuid' }),
  gate_id: Type.String({ format: 'uuid' }),
  utterance_seq: Type.Integer(),
  proposed_action: HitlProposedActionSchema,
  reviewer_id: Type.Union([Type.String(), Type.Null()]),
  decision: HitlDecisionStatusSchema,
  edited_arguments: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  justification_note: Type.Union([Type.String(), Type.Null()]),
  decided_at: Type.Union([Type.String(), Type.Null()]),
  latency_ms: Type.Union([Type.Integer(), Type.Null()]),
  outcome_notified_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
});
export type HitlDecisionDto = Static<typeof HitlDecisionSchema>;

/** `GET /hitl/queue` — pending decisions across every reviewer group the caller belongs to. */
export const ListHitlQueueResponseSchema = Type.Object({ items: Type.Array(HitlDecisionSchema) });
export type ListHitlQueueResponseDto = Static<typeof ListHitlQueueResponseSchema>;

/** R-H6 — approve, deny, or edit-and-approve. `justification_note` is optional on approve, required in spirit (not schema) on deny. */
export const DecideHitlDecisionRequestSchema = Type.Object(
  {
    action: Type.Union([Type.Literal('approve'), Type.Literal('deny'), Type.Literal('edit_approve')]),
    edited_arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    justification_note: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);
export type DecideHitlDecisionRequest = Static<typeof DecideHitlDecisionRequestSchema>;
