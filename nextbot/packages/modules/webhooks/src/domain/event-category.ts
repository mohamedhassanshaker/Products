import type { WebhookEventCategoryValue } from "@nextbot/contracts";

/**
 * The ONE place FR-API-02's tenant-facing event vocabulary is translated into real
 * `domain_event.type` strings. Investigation before this phase (see
 * docs/plans/public-api-webhooks-otel-siem-plan.md) audited every real
 * `domain_event`-producing call site in the codebase; two of the five categories had
 * no producer at all and were added as part of this phase (`escalations.
 * escalation_created`, `mcp-registry.drift_detected`), and a third category's most
 * common case (`agent-platform.deployment_created`) was also missing. This map is
 * intentionally the ONLY place that knows both vocabularies — a later phase adding a
 * new producer for one of these categories only ever needs to append its type string
 * here, never touch the dispatcher itself.
 */
export const EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES: Record<WebhookEventCategoryValue, readonly string[]> = {
  EscalationCreated: ["escalations.escalation_created"],
  ApprovalPending: ["orchestration.tool_call.awaiting_human_approval"],
  // Both represent a guardrail actually tripping (blocking), not merely being
  // evaluated — `authz`'s "guardrail.evaluator_error" is a system/evaluator FAILURE,
  // a different and narrower thing, and is deliberately excluded.
  GuardrailTripped: ["orchestration.turn.guardrail_blocked", "orchestration.tool_call.guardrail_injection_blocked"],
  DeploymentChanged: [
    "agent-platform.deployment_created",
    "agent-platform.canary_promoted",
    "agent-platform.traffic_split_changed",
    "agent-platform.emergency_rollback",
  ],
  DriftDetected: ["mcp-registry.drift_detected"],
};

/** All real `domain_event.type` values any active subscription could possibly care
 * about — the dispatcher's own "which rows are even candidates" filter, computed
 * once from the map above rather than hand-maintained a second time. */
export function allSubscribableDomainEventTypes(): string[] {
  return Array.from(new Set(Object.values(EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES).flat()));
}

/** The category (or categories — a type is never shared across categories in the map
 * above, but this returns an array for a fail-safe/defensive shape) a real
 * `domain_event.type` belongs to, or `[]` if the map doesn't know about the type at
 * all (a real producer that has genuinely nothing to do with these five categories —
 * expected and common, not an error). */
export function categoriesForDomainEventType(type: string): WebhookEventCategoryValue[] {
  return (Object.keys(EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES) as WebhookEventCategoryValue[]).filter((category) =>
    EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES[category].includes(type),
  );
}
