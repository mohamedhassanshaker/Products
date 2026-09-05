import type { TenantContext } from "@nextbot/db";
import { PromotionNotAllowedError, type AgentVersionStatusValue } from "@nextbot/contracts";
import { allowedTransitions, canPromote, type PromotionCheckInput, type PromotionCheckResult } from "../domain/promotion-policy.js";
import { getAgentDefinitionVersion, updateAgentDefinitionVersionStatus, type AgentDefinitionVersionRow } from "../infrastructure/agent-definition-repository.js";
import { getEvalRun } from "../infrastructure/eval-repository.js";
import { hasActiveTraffic, createInitialProductionDeployment } from "../infrastructure/deployment-repository.js";

/** Graph types this deployment can actually execute (ADR-0003 / NFR-12) — mirrors
 * `packages/ai-registry/src/graph-runtime/registry.ts`'s `resolveGraphRuntime` switch;
 * kept as a plain constant here (rather than importing `ai-registry` just to probe
 * it) since the set is small and stable. */
const INSTALLED_GRAPH_TYPES = ["ADK", "CustomFSM"] as const;

/** Re-derives every input `canPromote()` needs for `versionId`, live from the
 * database — shared by `promoteAgentVersion`, `getAllowedTransitionsForVersion`, and
 * `checkPromotionTarget` so the three never drift against each other.
 *
 * Deliberately Git-agnostic (confirmed while implementing ADR-0009's 2026-08-23
 * amendment): nothing in this function reads `git_connection` state, a version's
 * `gitCommitSha`/`gitPrNumber`, or calls into `git-connection-service.ts` — every
 * input it assembles (status, eval run, definition hash, graph type, active traffic)
 * comes from tables this module owns directly. This is why the whole promotion path
 * already worked, unmodified, for a tenant with zero Git connection configured before
 * this amendment even needed to touch this file. */
async function loadPromotionCheckInput(
  ctx: TenantContext,
  versionId: string,
  actingUserId: string | null,
): Promise<{ version: AgentDefinitionVersionRow; input: PromotionCheckInput }> {
  const version = await getAgentDefinitionVersion(ctx, versionId);
  const lastEvalRun = version.lastEvalRunId ? await getEvalRun(ctx, version.lastEvalRunId) : null;
  const activeTraffic = await hasActiveTraffic(ctx, versionId);
  return {
    version,
    input: {
      currentStatus: version.status,
      targetStatus: version.status, // overwritten by each caller
      createdByUserId: version.createdByUserId,
      actingUserId,
      lastEvalRun: lastEvalRun ? { status: lastEvalRun.status, definitionHash: lastEvalRun.definitionHash } : null,
      definitionHash: version.definitionHash,
      graphType: version.graphType,
      installedGraphTypes: INSTALLED_GRAPH_TYPES,
      hasActiveTraffic: activeTraffic,
      lastSandboxTestAt: version.lastSandboxTestAt,
    },
  };
}

/**
 * LLD §3.10's promotion gate, enforced for real (FR-AGT-01/06) — **not** just in the
 * console. Every transition re-derives its inputs from the database inside this one
 * function, so a client cannot bypass the eval gate or the reviewer!=author rule by
 * calling the API directly with a forged `_allowedTransitions` hint.
 *
 * @param actingUserId `null` represents the Git-merge-webhook actor (see
 * `promotion-policy.ts`'s doc comment on why that's always treated as distinct from
 * the version's creator).
 * @throws {PromotionNotAllowedError} with the specific blocking reason.
 */
export async function promoteAgentVersion(
  ctx: TenantContext,
  versionId: string,
  targetStatus: AgentDefinitionVersionRow["status"],
  actingUserId: string | null,
): Promise<AgentDefinitionVersionRow> {
  const { version, input } = await loadPromotionCheckInput(ctx, versionId, actingUserId);
  const result = canPromote({ ...input, targetStatus });
  if (!result.allowed) throw new PromotionNotAllowedError(result.reason);

  // BE2 fix (QA 2026-08-15 backend pass): guard the status transition with the
  // *current* status we just re-derived it from, closing the check-then-act race that
  // let two concurrent Approved -> Production promotions both succeed and each create
  // their own "active, 100%-traffic" Deployment row (violating the LLD's own
  // SUM(traffic_split_pct)=100 invariant). If the row's status already moved out from
  // under us between the read above and this write, `updated` is false — treat it the
  // same as any other promotion-not-allowed outcome rather than silently proceeding to
  // create a second Production deployment.
  const updated = await updateAgentDefinitionVersionStatus(ctx, versionId, {
    status: targetStatus,
    approvedByUserId: targetStatus === "Approved" ? actingUserId : undefined,
    expectedCurrentStatus: version.status,
  });
  if (!updated) {
    const fresh = await getAgentDefinitionVersion(ctx, versionId);
    throw new PromotionNotAllowedError(`this version's status changed concurrently (now '${fresh.status}') — reload and try again`);
  }

  // LLD §3.10: "Approved -> Production ... requires ... an active Deployment row
  // created atomically" — created here, in the same promotion call, not left for a
  // separate BL-13 canary-editor step (full traffic-split editing is BL-13; this is
  // just the row the gate itself requires to exist).
  if (targetStatus === "Production") {
    await createInitialProductionDeployment(ctx, {
      agentDefinitionId: version.agentDefinitionId,
      agentDefinitionVersionId: versionId,
      environment: "Production",
      actorUserId: actingUserId,
    });
  }

  return getAgentDefinitionVersion(ctx, versionId);
}

/** Backs the API's `_allowedTransitions` response field (LLD §3.10) — computed against
 * the *current caller*, so a version's creator genuinely sees `Approved` hidden (not
 * merely disabled) from their own view, per LLD's "hides, not merely disables". */
export async function getAllowedTransitionsForVersion(ctx: TenantContext, versionId: string, callingUserId: string | null): Promise<AgentDefinitionVersionRow["status"][]> {
  const { input } = await loadPromotionCheckInput(ctx, versionId, callingUserId);
  return allowedTransitions(input);
}

/**
 * UX_GUIDELINES.md §6.4's "(?) Why can't I promote this further?" affordance — a
 * read-only probe of `canPromote()` for a *specific* target status that isn't
 * currently allowed, so the console can show the exact blocking reason (verbatim,
 * never paraphrased) without the caller needing to guess from `_allowedTransitions`
 * alone. Never throws — always returns the same `{allowed, reason?}` shape
 * `canPromote()` itself produces.
 */
export async function checkPromotionTarget(
  ctx: TenantContext,
  versionId: string,
  targetStatus: AgentVersionStatusValue,
  callingUserId: string | null,
): Promise<PromotionCheckResult> {
  const { input } = await loadPromotionCheckInput(ctx, versionId, callingUserId);
  return canPromote({ ...input, targetStatus });
}
