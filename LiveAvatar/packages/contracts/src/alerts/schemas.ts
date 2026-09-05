import { Type, type Static } from '@sinclair/typebox';

/** `GET /tenants/{id}/alert-policy` response (FR-ALERT-1). */
export const AlertPolicyResponseSchema = Type.Object({
  retry_max_attempts: Type.Integer({ minimum: 1, maximum: 5 }),
  retry_backoff_ms: Type.Array(Type.Integer({ minimum: 0 })),
  degraded_mode_message: Type.String({ minLength: 1, maxLength: 500 }),
  llm_fallback: Type.Union([
    Type.Object({ provider: Type.String(), model: Type.String(), credential_ref: Type.Optional(Type.String()) }),
    Type.Null(),
  ]),
  updated_at: Type.String(),
});
/** Inferred alert-policy response. */
export type AlertPolicyResponse = Static<typeof AlertPolicyResponseSchema>;

/**
 * `PUT /tenants/{id}/alert-policy` request (FR-ALERT-1). `llm_fallback` is
 * documented but not persisted by this endpoint (see
 * `UpdateAlertPolicyUseCase`'s docstring) — fallback LLM *identity* stays
 * Agent-Builder-owned per `docs/design/UX_GUIDELINES.md` §16.9's resolution.
 */
export const UpdateAlertPolicyRequestSchema = Type.Object({
  retry_max_attempts: Type.Integer({ minimum: 1, maximum: 5 }),
  retry_backoff_ms: Type.Array(Type.Integer({ minimum: 0 })),
  degraded_mode_message: Type.String({ minLength: 1, maxLength: 500 }),
  llm_fallback: Type.Optional(
    Type.Union([
      Type.Object({ provider: Type.String(), model: Type.String(), credential_ref: Type.Optional(Type.String()) }),
      Type.Null(),
    ]),
  ),
});
/** Inferred update-alert-policy request. */
export type UpdateAlertPolicyRequest = Static<typeof UpdateAlertPolicyRequestSchema>;

/** `GET /tenants/{id}/alerts` query (FR-ALERT-4). */
export const ListAlertsQuerySchema = Type.Object({
  type: Type.Optional(
    Type.Union([
      Type.Literal('llm_failover'),
      Type.Literal('provider_unreachable'),
      Type.Literal('session_failed'),
      Type.Literal('gpu_unhealthy'),
      Type.Literal('handoff_requested'),
    ]),
  ),
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
});
/** Inferred alerts-list query. */
export type ListAlertsQuery = Static<typeof ListAlertsQuerySchema>;

/** One `GET /tenants/{id}/alerts` row. */
export const AlertEventDtoSchema = Type.Object({
  id: Type.String(),
  type: Type.String(),
  message: Type.String(),
  created_at: Type.String(),
});
/** Inferred alert event. */
export type AlertEventDto = Static<typeof AlertEventDtoSchema>;

/** `GET /tenants/{id}/failover-stats` query (FR-ALERT-2). */
export const FailoverStatsQuerySchema = Type.Object({
  range: Type.Optional(Type.Union([Type.Literal('1h'), Type.Literal('24h'), Type.Literal('7d')])),
});
/** Inferred failover-stats query. */
export type FailoverStatsQuery = Static<typeof FailoverStatsQuerySchema>;

/** `GET /tenants/{id}/failover-stats` response (FR-ALERT-2). */
export const FailoverStatsResponseSchema = Type.Object({
  primary_failures: Type.Integer(),
  fallback_successes: Type.Integer(),
  degraded_invocations: Type.Integer(),
});
/** Inferred failover-stats response. */
export type FailoverStatsResponse = Static<typeof FailoverStatsResponseSchema>;
