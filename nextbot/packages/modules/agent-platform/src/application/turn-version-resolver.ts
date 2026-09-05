import type { TenantContext } from "@nextbot/db";
import { chooseTrafficAllocation, trafficBucketFor } from "../domain/traffic-bucket.js";
import { findActiveAgentDefinitionVersionTenantWideFallback } from "../infrastructure/agent-definition-repository.js";
import {
  findLiveTrafficAssignment,
  listActiveDeploymentAllocations,
  upsertTrafficAssignment,
} from "../infrastructure/traffic-assignment-repository.js";

/** Which version serves this turn, and which `deployment` row said so. */
export interface ResolvedTurnAgentVersion {
  agentDefinitionVersionId: string;
  /** `null` only for the legacy tenant-wide fallback, which is not deployment-driven. */
  deploymentId: string | null;
  /** How this answer was reached — recorded on the turn's span attributes and surfaced in
   *  tests so a resolution can be attributed rather than guessed at. */
  source: "TenantWideFallback" | "StickyAssignment" | "WeightedSplit";
}

export interface ResolveTurnAgentVersionInput {
  conversationId: string;
  /** Supplied by the composition root from `channel.agent_definition_id`. `null` means
   *  the channel has no binding — a supported state, not an error. */
  agentDefinitionId: string | null;
  environment: "Sandbox" | "Staging" | "Production";
}

/**
 * **The Phase 17 live version resolver** (BL-48, ADR-0019 §2.3, LLD §15.3) — the second
 * hop of the resolution chain
 * `channel → agent definition → deployment traffic split → version`.
 *
 * This module may not depend on `conversations` or `channels` (LLD §14.1's allow-list), so
 * the composition root (`apps/gateway`) does the `channelId → agentDefinitionId` lookup and
 * passes ids down; this function never reads a `channel` or `conversation` row.
 * `previewVersionId` (sandbox preview) short-circuits *before* this function is called and
 * is unchanged.
 *
 * The algorithm, in order:
 *
 * 1. **No binding** (`agentDefinitionId === null`) → the retained tenant-wide fallback,
 *    i.e. byte-for-byte the pre-Phase-17 behavior. ADR-0019 §6 item 10 requires this to
 *    stay true, proven by the existing widget/WhatsApp suites passing unmodified.
 * 2. **Sticky assignment, bounded by the deployment's own `is_active` lifetime.** A live
 *    assignment is honoured; a stale one (its deployment has since been deactivated by a
 *    promotion, split change, rollback or emergency rollback) is DISCARDED and re-resolved.
 *    This is what keeps ADR-0017 true for in-flight conversations.
 * 3. **Deterministic weighted selection** over the active rows ordered by `deployment.id`
 *    — `sha256(conversationId + ':' + agentDefinitionId) mod 10000` walked against
 *    cumulative `traffic_split_pct * 100`. Zero active rows → `null`, today's honest
 *    "no agent run to trace yet" behavior, unchanged.
 * 4. Persist the assignment, then return.
 *
 * **There is no routing cache and must not be one** (ADR-0019 §2.3): one indexed
 * single-row `SELECT` per turn is negligible beside a model call, and a TTL cache is in
 * direct tension with NFR-2's <5s rollback bound — a 5s TTL would consume the entire
 * budget before a repoint was even visible.
 *
 * A failure to persist the assignment (step 4) is deliberately **not** fatal: the bucket
 * is deterministic, so the very next turn re-derives the identical answer from the same
 * active set. Failing the customer's turn over a stickiness bookkeeping write would be a
 * strictly worse outcome than the (invisible) loss of one write.
 *
 * @param ctx tenant context.
 * @param input the conversation, the bound agent definition (or `null`), and the
 *   deployment environment.
 * @returns the resolved version, or `null` when nothing is deployed for this agent yet.
 */
export async function resolveTurnAgentVersion(ctx: TenantContext, input: ResolveTurnAgentVersionInput): Promise<ResolvedTurnAgentVersion | null> {
  if (input.agentDefinitionId === null) {
    const fallback = await findActiveAgentDefinitionVersionTenantWideFallback(ctx);
    return fallback ? { agentDefinitionVersionId: fallback.id, deploymentId: null, source: "TenantWideFallback" } : null;
  }

  const sticky = await findLiveTrafficAssignment(ctx, input.conversationId, input.agentDefinitionId);
  if (sticky) {
    return { agentDefinitionVersionId: sticky.agentDefinitionVersionId, deploymentId: sticky.deploymentId, source: "StickyAssignment" };
  }

  const candidates = await listActiveDeploymentAllocations(ctx, input.agentDefinitionId, input.environment);
  const chosen = chooseTrafficAllocation(candidates, trafficBucketFor(input.conversationId, input.agentDefinitionId));
  if (!chosen) return null;

  try {
    await upsertTrafficAssignment(ctx, {
      conversationId: input.conversationId,
      agentDefinitionId: input.agentDefinitionId,
      deploymentId: chosen.deploymentId,
      agentDefinitionVersionId: chosen.agentDefinitionVersionId,
    });
  } catch (err) {
    // See the doc comment above: deterministic re-derivation makes this recoverable, and
    // the customer's turn must not fail over a bookkeeping write.
    console.error("NextBot agent-platform: failed to persist traffic assignment (non-fatal)", err);
  }

  return { agentDefinitionVersionId: chosen.agentDefinitionVersionId, deploymentId: chosen.deploymentId, source: "WeightedSplit" };
}
