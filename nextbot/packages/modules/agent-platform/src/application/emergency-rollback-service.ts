import type { TenantContext } from "@nextbot/db";
import { EmergencyRollbackNotEligibleError, EmergencyRollbackReasonRequiredError } from "@nextbot/contracts";
import { checkEmergencyRollbackEligibility } from "../domain/emergency-rollback-policy.js";
import { getAgentDefinitionVersion, type AgentDefinitionVersionRow } from "../infrastructure/agent-definition-repository.js";
import { emergencyRollbackRepoint, hasEverBeenProductionInHistory, type DeploymentRow } from "../infrastructure/deployment-repository.js";

/**
 * ADR-0017 (FR-AGT-30, BL-27) — the emergency-rollback bypass. Every clause of the
 * ADR's invariant is enforced here, never left to the caller:
 *
 *   1. **Existing and immutable** — this function has no create/update path onto
 *      `agent_definition_version`; it only ever *reads* `targetVersionId` and repoints
 *      traffic to it. `getAgentDefinitionVersion` throws `AgentVersionNotFoundError`
 *      (existing behavior) if the id doesn't resolve at all.
 *   2. **Of the same agent definition** — `target.agentDefinitionId` is compared
 *      against the route's own path-scoped `agentDefinitionId` param, never inferred
 *      from the request body alone (a cross-definition "rollback" is a promotion, not
 *      a rollback — ADR-0017 §2.1).
 *   3. **Previously Production, with a recorded passing gate outcome** —
 *      `hasEverBeenProductionInHistory` re-derives this live from `deployment_history`
 *      on every call; never cached, never inferred from the version's current status.
 *
 * @throws {EmergencyRollbackNotEligibleError} cross-definition target, or a target
 * that was never previously Production (Draft/EvalGated/HumanReview/Approved-never-
 * promoted all land here — no override exists for any of them, per ADR-0017 §2.1).
 * @throws {EmergencyRollbackReasonRequiredError} a blank (or whitespace-only) reason —
 * the exact FR-AGT-30 message ("A reason is required for emergency rollback").
 */
export async function emergencyRollback(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: { targetVersionId: string; reason: string },
  actorUserId: string | null,
): Promise<{ deployment: DeploymentRow; target: AgentDefinitionVersionRow }> {
  const target = await getAgentDefinitionVersion(ctx, input.targetVersionId);
  const trimmedReason = input.reason.trim();

  const wasEverProductionWithPassingGate = await hasEverBeenProductionInHistory(ctx, input.targetVersionId);

  const check = checkEmergencyRollbackEligibility({
    sameAgentDefinition: target.agentDefinitionId === agentDefinitionId,
    wasEverProductionWithPassingGate,
    trimmedReason,
  });
  if (!check.allowed) {
    throw check.code === "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" ? new EmergencyRollbackNotEligibleError() : new EmergencyRollbackReasonRequiredError();
  }

  const deployment = await emergencyRollbackRepoint(ctx, {
    agentDefinitionId,
    targetVersionId: input.targetVersionId,
    reason: trimmedReason,
    actorUserId,
  });

  return { deployment, target };
}
