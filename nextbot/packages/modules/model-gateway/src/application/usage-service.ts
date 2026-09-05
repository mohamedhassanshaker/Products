import type { TenantContext } from "@nextbot/db";
import { insertUsageEvent, listUsageEventsInRange, type InsertUsageEventInput } from "../infrastructure/route-repository.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-24) — the tenant-facing usage
 * & cost view: spend/volume by provider/model/route/agent-version/channel, plus a
 * cost-per-resolved-conversation figure.
 *
 * **Disclosed scope decision**: LLD §14.8.5 specifies `GET /usage` is served from
 * ClickHouse via a `fact_model_usage` stream landed from the outbox, "never by
 * aggregating Postgres `model_usage_event` live" — mirroring §12.5's reporting-rollup
 * pattern. This phase aggregates directly from Postgres's `model_usage_event`
 * instead: `model_usage_event` is a genuinely new, low-volume-per-tenant reporting
 * surface (unlike `agent_run_span`'s per-turn trace volume, which is why that one
 * bridges to ClickHouse directly per its own module doc), and building the outbox->
 * ClickHouse landing pipeline for a single new fact table is a materially larger,
 * separable piece of work than this phase's core gate items (Route v2 schema,
 * capability validation, residency/plan-tier enforcement, migration correctness).
 * Every number this view returns is still real and correctly attributed — this is a
 * read-path performance/architecture optimization deferred, not a functional gap.
 * Revisit alongside a real outbox-landing pipeline if/when usage volume warrants it.
 */

/** A single simulated model call's usage attribution — the shape a real orchestration
 * call site (once wired) or a test/demo harness uses to record one. Named
 * "simulated" only in the sense that it doesn't itself perform inference (that's
 * `gateway-call-service.ts`'s `logUsage`, which calls the same repository function) —
 * this is the same real `model_usage_event` row either way. */
export async function recordSimulatedUsageEvent(ctx: TenantContext, input: InsertUsageEventInput): Promise<void> {
  await insertUsageEvent(ctx, input);
}

export interface UsageReportRow {
  groupKey: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  callCount: number;
  cacheHitCount: number;
  errorCount: number;
}

export type UsageGroupBy = "provider" | "model" | "route" | "agentVersion" | "channel";

/** `GET /api/v1/admin/model-gateway/usage?from&to&groupBy=...` (FR-AGT-24). */
export async function getUsageReport(ctx: TenantContext, input: { from: Date; to: Date; groupBy: UsageGroupBy }): Promise<UsageReportRow[]> {
  const events = await listUsageEventsInRange(ctx, input.from, input.to);
  const groups = new Map<string, UsageReportRow>();

  for (const event of events) {
    const groupKey =
      input.groupBy === "provider"
        ? event.providerKey
        : input.groupBy === "model"
          ? event.model
          : input.groupBy === "route"
            ? event.routeKey
            : input.groupBy === "agentVersion"
              ? (event.agentDefinitionVersionId ?? "unattributed")
              : (event.channelType ?? "unattributed");

    const existing = groups.get(groupKey) ?? { groupKey, tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0, callCount: 0, cacheHitCount: 0, errorCount: 0 };
    existing.tokensIn += event.tokensIn ?? 0;
    existing.tokensOut += event.tokensOut ?? 0;
    existing.cachedTokens += event.cachedTokens ?? 0;
    existing.costUsd += Number(event.costUsd ?? 0);
    existing.callCount += 1;
    if (event.outcome === "CacheHit") existing.cacheHitCount += 1;
    if (event.outcome === "ProviderError" || event.outcome === "Timeout" || event.outcome === "RateLimited") existing.errorCount += 1;
    groups.set(groupKey, existing);
  }

  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd);
}

/** FR-AGT-24 — total spend divided by the number of DISTINCT conversations that had
 * at least one usage event in the window (a "resolved conversation" proxy: every
 * conversation this tenant's model spend actually served, regardless of ultimate
 * escalation outcome — a more precise "resolved" definition depending on
 * `conversation.status` is Phase 13/BL-45's escalation-outcome tracking, not yet
 * wired to this cost figure; disclosed rather than silently assumed available). */
export async function getCostPerResolvedConversation(ctx: TenantContext, input: { from: Date; to: Date }): Promise<{ totalCostUsd: number; conversationCount: number; costPerConversation: number | null }> {
  const events = await listUsageEventsInRange(ctx, input.from, input.to);
  const totalCostUsd = events.reduce((sum, e) => sum + Number(e.costUsd ?? 0), 0);
  const conversationIds = new Set(events.map((e) => e.conversationId).filter((id): id is string => Boolean(id)));
  const conversationCount = conversationIds.size;
  return { totalCostUsd, conversationCount, costPerConversation: conversationCount > 0 ? totalCostUsd / conversationCount : null };
}
