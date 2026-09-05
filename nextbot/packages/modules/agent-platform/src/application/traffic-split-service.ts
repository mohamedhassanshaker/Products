import type { TenantContext } from "@nextbot/db";
import {
  DeploymentReasonRequiredError,
  TrafficSplitInvalidError,
  VersionNotInDefinitionError,
  VersionNotProductionError,
} from "@nextbot/contracts";
import { checkTrafficSplitAllocations, type TrafficAllocationInput } from "../domain/traffic-split-policy.js";
import { getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import {
  listActiveDeploymentsForAgentEnvironment,
  listDeploymentHistory,
  promoteCanary as promoteCanaryRepo,
  setTrafficSplit as setTrafficSplitRepo,
  type DeploymentRow,
} from "../infrastructure/deployment-repository.js";

/**
 * The application-layer gate in front of Phase 17's multi-row deployment writers
 * (BL-48/BL-13, ADR-0019 §2.4/§2.7, LLD §15.4).
 *
 * Everything that requires a database read to decide lives here; the pure shape rules live
 * in `domain/traffic-split-policy.ts`; the transaction, advisory lock, history row and
 * outbox event live in `infrastructure/deployment-repository.ts`. The split is deliberate
 * — the *security-relevant* rule below (§2.4's Production precondition) is a small,
 * directly readable function rather than something buried inside a transaction body.
 */

/**
 * **ADR-0019 §2.4, the one rule that keeps ADR-0017's core claim true.**
 *
 * Every version receiving canary traffic must ALREADY hold `Production` status for THIS
 * agent definition — meaning it already went through `canPromote(Approved → Production)`
 * (eval green, reviewer ≠ author, sandbox test recorded, graph type installed) exactly as
 * a 100% promotion does.
 *
 * Canary is therefore **not a second route to production**: starting a 90/10 canary is
 * "promote the candidate through the existing gate, then allocate it 10%", never "put an
 * Approved version in front of 10% of customers without the gate". Phase 17 introduces no
 * new gate-bypass surface at all, and `emergencyRollbackRepoint` remains the only audited
 * bypass in the system.
 *
 * @throws {VersionNotInDefinitionError} an allocated version belongs to a different agent
 *   definition than the one the caller's path scopes this to (checked against the version
 *   row itself, never inferred from the request body).
 * @throws {VersionNotProductionError} an allocated version has not been promoted to
 *   `Production`.
 */
async function assertAllocationsAreEligible(ctx: TenantContext, agentDefinitionId: string, allocations: TrafficAllocationInput[]): Promise<void> {
  for (const allocation of allocations) {
    // Throws `AgentVersionNotFoundError` (existing behavior) for an id that does not
    // resolve at all, and is RLS-scoped, so a cross-tenant id is indistinguishable from a
    // nonexistent one.
    const version = await getAgentDefinitionVersion(ctx, allocation.agentDefinitionVersionId);
    if (version.agentDefinitionId !== agentDefinitionId) {
      throw new VersionNotInDefinitionError(allocation.agentDefinitionVersionId);
    }
    if (version.status !== "Production") {
      throw new VersionNotProductionError(version.version);
    }
  }
}

/** Shared reason validation — a blank/whitespace-only reason on an audited deployment
 *  action is rejected server-side regardless of what any client-side control allowed,
 *  mirroring emergency rollback's own trimmed-value re-check. */
function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) throw new DeploymentReasonRequiredError();
  return trimmed;
}

/**
 * FR-AGT-04/05's "per agent/environment, admins configure active version and optional
 * traffic split across versions (e.g. 90/10 canary)" — the first time this codebase can
 * actually do it.
 *
 * @param ctx tenant context.
 * @param agentDefinitionId the agent definition, from the route path (never the body).
 * @param input environment, allocation set and audit reason.
 * @param actorUserId the acting admin, for `deployment_history` and the outbox event.
 * @returns the newly-active deployment rows.
 * @throws {TrafficSplitInvalidError} allocations do not sum to 100, or are otherwise
 *   malformed (duplicate version, out-of-range percentage, empty set).
 * @throws {VersionNotProductionError} / {@link VersionNotInDefinitionError} see
 *   `assertAllocationsAreEligible`.
 * @throws {DeploymentReasonRequiredError} blank reason.
 */
export async function setTrafficSplit(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: { environment: "Sandbox" | "Staging" | "Production"; allocations: TrafficAllocationInput[]; reason: string },
  actorUserId: string | null,
): Promise<DeploymentRow[]> {
  const reason = requireReason(input.reason);
  const check = checkTrafficSplitAllocations(input.allocations);
  if (!check.valid) throw new TrafficSplitInvalidError(check.code, check.detail);
  await assertAllocationsAreEligible(ctx, agentDefinitionId, input.allocations);

  return setTrafficSplitRepo(ctx, {
    agentDefinitionId,
    environment: input.environment,
    allocations: input.allocations,
    reason,
    actorUserId,
  });
}

/**
 * FR-AGT-04's "Promote canary to 100%" — collapse the split onto one version.
 *
 * Runs the **same** `Production`-status precondition as `setTrafficSplit`: promoting a
 * canary to 100% is not a way to hand full traffic to something that never passed the
 * gate, it is a way to end a split that only ever contained gated versions in the first
 * place.
 */
export async function promoteCanary(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: { environment: "Sandbox" | "Staging" | "Production"; agentDefinitionVersionId: string; reason: string },
  actorUserId: string | null,
): Promise<DeploymentRow[]> {
  const reason = requireReason(input.reason);
  await assertAllocationsAreEligible(ctx, agentDefinitionId, [{ agentDefinitionVersionId: input.agentDefinitionVersionId, trafficSplitPct: 100 }]);

  return promoteCanaryRepo(ctx, {
    agentDefinitionId,
    environment: input.environment,
    agentDefinitionVersionId: input.agentDefinitionVersionId,
    reason,
    actorUserId,
  });
}

export { listActiveDeploymentsForAgentEnvironment, listDeploymentHistory };
