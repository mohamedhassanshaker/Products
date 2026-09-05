import { Type, type Static } from "@sinclair/typebox";
import { MessagePayloadSchema } from "./messages.js";

/** Phase 16 (BL-09) — request/response contracts for the escalation queue, live
 * takeover panel, and routing config admin surfaces (LLD §5.8). */

export const SendHumanAgentMessageRequestSchema = Type.Object({
  payload: MessagePayloadSchema,
});
export type SendHumanAgentMessageRequest = Static<typeof SendHumanAgentMessageRequestSchema>;

export const ReassignEscalationRequestSchema = Type.Object({
  queueId: Type.Optional(Type.String({ minLength: 1 })),
  agentId: Type.Optional(Type.String({ minLength: 1 })),
});
export type ReassignEscalationRequest = Static<typeof ReassignEscalationRequestSchema>;

/** B.5.2's "manual tool invocation" panel — reuses the same `toolId`/`args` shape
 * the turn pipeline's own `ToolInvocation` uses, scoped down to just what a human
 * agent supplies (connector/idempotency-key are resolved server-side). */
export const ManualToolInvokeRequestSchema = Type.Object({
  toolId: Type.String({ minLength: 1 }),
  args: Type.Record(Type.String(), Type.Unknown()),
});
export type ManualToolInvokeRequest = Static<typeof ManualToolInvokeRequestSchema>;

const RoutingRuleConditionsSchema = Type.Object({
  recognizedGoal: Type.Optional(Type.String()),
  channelTypes: Type.Optional(Type.Array(Type.String())),
  reasons: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("LowConfidence"),
        Type.Literal("ToolFailure"),
        Type.Literal("CustomerRequest"),
        Type.Literal("SensitiveTopic"),
      ]),
    ),
  ),
  language: Type.Optional(Type.String()),
});

export const ReplaceRoutingRulesRequestSchema = Type.Object({
  rules: Type.Array(
    Type.Object({
      conditions: RoutingRuleConditionsSchema,
      queueId: Type.String({ minLength: 1 }),
      enabled: Type.Boolean(),
    }),
  ),
});
export type ReplaceRoutingRulesRequest = Static<typeof ReplaceRoutingRulesRequestSchema>;

export const CreateAgentQueueRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  isDefault: Type.Optional(Type.Boolean()),
  queueExternalRef: Type.Optional(Type.String({ maxLength: 500 })),
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — optional SLA target,
  // in seconds; omitted/absent means "no SLA configured for this queue".
  slaSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type CreateAgentQueueRequest = Static<typeof CreateAgentQueueRequestSchema>;

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — CSAT capture at the
 * close of a takeover. Both fields optional: a human agent is never blocked from
 * closing out an escalation for skipping CSAT (see `application/return-to-bot.ts`'s
 * doc comment).
 */
export const CsatCaptureRequestSchema = Type.Object({
  csatScore: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  csatComment: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CsatCaptureRequest = Static<typeof CsatCaptureRequestSchema>;

/** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — `agent_presence.state`
 * vocabulary, mirrored verbatim from `packages/db/src/schema/enums.ts`. */
export const AgentPresenceStateSchema = Type.Union([
  Type.Literal("Available"),
  Type.Literal("Busy"),
  Type.Literal("Away"),
  Type.Literal("Offline"),
]);
export type AgentPresenceStateValue = Static<typeof AgentPresenceStateSchema>;

/** Self-service presence toggle request body — deliberately state-only (no
 * `maxConcurrent`); an agent may never raise their own concurrency ceiling. */
export const SetAgentPresenceStateRequestSchema = Type.Object({
  state: AgentPresenceStateSchema,
});
export type SetAgentPresenceStateRequest = Static<typeof SetAgentPresenceStateRequestSchema>;

/** Admin-configured per-agent ceiling request body (targets an explicit `userId` in
 * the route path, not this body — see `apps/web/app/api/v1/admin/agent-presence/
 * [userId]/route.ts`). */
export const SetAgentMaxConcurrentRequestSchema = Type.Object({
  maxConcurrent: Type.Integer({ minimum: 0, maximum: 100 }),
});
export type SetAgentMaxConcurrentRequest = Static<typeof SetAgentMaxConcurrentRequestSchema>;
