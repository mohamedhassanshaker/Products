import yaml from "js-yaml";
import type { TenantContext } from "@nextbot/db";
import { diffArtifact, type ChangeSet } from "@nextbot/yaml-diff";
import {
  GitConnectionNotFoundError,
  type AgentDefinitionArtifact,
  type CreateAgentDefinitionRequest,
  type CreateAgentDefinitionVersionRequest,
  type GitDiffResult,
} from "@nextbot/contracts";
import { resolveOrSynthesizeRouteVersionForKey, assertRouteSatisfies } from "@nextbot/model-gateway";
import { resolveSkillPin } from "@nextbot/skills";
import { resolveKnowledgeCollectionPin, deriveAclTags } from "@nextbot/knowledge";
import type { ResolvedAgentKnowledgeConfig } from "@nextbot/db";
import { hashDefinitionArtifact } from "../domain/definition-hash.js";
import { validateAgentDefinitionArtifact } from "./artifact-validator.js";
import {
  createAgentDefinition as insertAgentDefinition,
  getAgentDefinition,
  listAgentDefinitionsWithSummary,
  insertAgentDefinitionVersion,
  getAgentDefinitionVersion,
  listAgentDefinitionVersions,
  setVersionEvalBinding,
  recordAgentDefinitionVersionSandboxTest,
  type AgentDefinitionRow,
  type AgentDefinitionListItem,
  type AgentDefinitionVersionRow,
} from "../infrastructure/agent-definition-repository.js";
import { getEvalRun } from "../infrastructure/eval-repository.js";
import { commitAgentDefinitionVersion, diffAgentDefinitionVersions, openAgentDefinitionReview, setVersionGitPrInfo } from "./git-connection-service.js";
import { getAllowedTransitionsForVersion } from "./promote-version-service.js";
import { hasEverBeenProductionInHistory } from "../infrastructure/deployment-repository.js";

export interface AgentDefinitionVersionView extends AgentDefinitionVersionRow {
  _allowedTransitions: AgentDefinitionVersionRow["status"][];
  /** U7 fix (QA 2026-08-15 UI pass, low) — the actual outcome of the version's last
   * eval run (`null` when none has ever run yet), so the console's `EvalBadge` can
   * distinguish "ran and passed" / "ran and failed" from a flat "Ran" for every run
   * regardless of outcome. */
  lastEvalRunStatus: "Queued" | "Running" | "Passed" | "Failed" | "Error" | null;
  /** Phase 6 (BL-27, ADR-0017) — mirrors `hasEverBeenProductionInHistory` exactly, so
   * the console can hide (not merely disable) the "Emergency rollback" action for a
   * version that could never pass the server-side eligibility check anyway. A UI hint
   * only — `emergencyRollback()` re-derives the same fact server-side on every call
   * and never trusts this flag. */
  _emergencyRollbackEligible: boolean;
}

export async function createAgentDefinition(ctx: TenantContext, input: CreateAgentDefinitionRequest): Promise<AgentDefinitionRow> {
  return insertAgentDefinition(ctx, input);
}

export async function listDefinitions(ctx: TenantContext): Promise<AgentDefinitionListItem[]> {
  return listAgentDefinitionsWithSummary(ctx);
}

export async function getDefinition(ctx: TenantContext, id: string): Promise<AgentDefinitionRow> {
  return getAgentDefinition(ctx, id);
}

/**
 * FR-AGT-01/§7.3 — creates a new `Draft` version. **Postgres is the version's real
 * source of truth (ADR-0009's 2026-08-23 amendment):** `definition_yaml`/
 * `definition_hash` are always written, regardless of Git state. When the tenant has
 * a Git connection configured, the artifact is still committed to that remote first (a
 * real commit) and `git_commit_sha` is written from that same commit, so the DB row
 * never claims a commit that doesn't exist — Git remains the review artifact and the
 * diff/PR source (FR-AGT-02/03) whenever it's connected. When the tenant has **no**
 * Git connection configured at all (`GitConnectionNotFoundError`), that's no longer a
 * hard block — the version is still created, with `git_commit_sha: null`, and Git sync
 * is simply skipped (best-effort, not a gate). A **genuine** failure against a
 * connection that *is* configured (`GitConnectionUnavailableError` from a health-check
 * failure, or any other unexpected error mid-commit) is a materially different
 * situation — an operator who believes Git sync is working would otherwise have no way
 * to know it silently stopped — so that case is re-thrown as-is, never swallowed into
 * the not-connected path.
 */
export async function createAgentDefinitionVersion(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: CreateAgentDefinitionVersionRequest,
  createdByUserId: string | null,
  /** Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.4) — internal-only
   * provenance stamp used exclusively by `skill-upgrade-service.ts` when this call
   * is regenerating a Draft on behalf of "upgrade consumers". Never set by any
   * ordinary console/API caller — `CreateAgentDefinitionVersionRequestSchema` has
   * no such field, so an external caller cannot forge this stamp. */
  upgradeProvenance?: { upgradeSourceVersionId: string; upgradedSkillVersionId: string },
): Promise<AgentDefinitionVersionRow> {
  // Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-13/14) — THE single
  // validator every authoring mode (Text, Design, Studio) calls: structural
  // `AgentDefinitionArtifactSchema` validation, plus FR-AGT-14's guardrail
  // tightening-only invariant against the tenant floor. Runs before ANY write
  // below (the Git commit, the skill/knowledge pin resolution, the DB insert) —
  // a rejection here never leaves a partial version behind.
  const validatedArtifact = await validateAgentDefinitionArtifact(ctx, input.artifact);

  const yamlContent = yaml.dump(validatedArtifact);
  const definitionHash = hashDefinitionArtifact(validatedArtifact);

  // Target Architecture Blueprint Phase 2 (BL-33, ADR-0011 §2.2, LLD §14.8.4,
  // FR-AGT-22) — resolve `modelRouteKey` to a real, immutable `route@version` pin
  // (synthesizing a conservative fallback route if none is configured yet, mirroring
  // migration `0045`'s own historical-data fallback so this never blocks a version
  // whose route just hasn't been configured through the console yet), then reject
  // the save outright if the artifact's `requiredCapabilities` (explicit, or
  // inferred `toolCalling: true` whenever `toolPolicy.capabilityGroups` is
  // non-empty) exceed what that route version's frozen, save-time-computed
  // `advertisedCapabilities` actually supports — a save-time rejection, never a
  // runtime surprise.
  const routeVersion = await resolveOrSynthesizeRouteVersionForKey(ctx, input.modelRouteKey);
  const required = {
    ...validatedArtifact.spec.requiredCapabilities,
    toolCalling: validatedArtifact.spec.requiredCapabilities?.toolCalling ?? validatedArtifact.spec.toolPolicy.capabilityGroups.length > 0,
  };
  assertRouteSatisfies(required, routeVersion, input.modelRouteKey);

  let commitSha: string | null = null;
  try {
    ({ commitSha } = await commitAgentDefinitionVersion(ctx, { agentDefinitionId, version: input.version, yamlContent }));
  } catch (err) {
    if (err instanceof GitConnectionNotFoundError) {
      // No tenant Git connection configured at all — degrade gracefully rather than
      // block. `commitSha` stays `null`; nothing was committed anywhere, so there is
      // nothing stale to reconcile later, and the tenant can connect Git at any later
      // point without this version needing to be recreated.
      // No service-level logger exists yet in this module (none named by the LLD for
      // agent-platform); a plain console line mirrors this codebase's existing
      // seed-script precedent for a visible, non-throwing degrade notice. Revisit if/
      // when a shared logger is adopted here.
      console.warn(`[agent-platform] createAgentDefinitionVersion: no Git connection for tenant ${ctx.tenantId} — version ${agentDefinitionId}@${input.version} created without a Git commit.`);
    } else {
      // A configured connection's health check failed (GitConnectionUnavailableError)
      // or some other unexpected error occurred mid-commit — surface it distinctly,
      // never collapsed into the graceful not-connected path above.
      throw err;
    }
  }

  // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.1/§2.3, LLD §14.5.3)
  // — resolve every `spec.skills` pin ("refund_request@3") to its real,
  // immutable `skill_version` row BEFORE this version is ever persisted: a pin
  // naming a skill/version that doesn't exist (or belongs to another tenant, per
  // RLS) fails the save outright, exactly like a route-capability mismatch above
  // — never a dangling reference. Ordinal is the pin's position in the array,
  // matching ADR-0015 §2.4's "composition order, affects instruction-fragment
  // assembly order" (LLD §14.5.3).
  const skillPins = await Promise.all(
    (validatedArtifact.spec.skills ?? []).map(async (pin, ordinal) => {
      const resolved = await resolveSkillPin(ctx, pin);
      return { skillId: resolved.skillId, skillVersionId: resolved.skillVersionId, ordinal };
    }),
  );

  // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, Blueprint §7.5) —
  // resolve `spec.plannerRoute` (default `"chat.router"`, ADR-0011 §2.2's standard
  // router role) and `spec.knowledge.collections` (each `"<name>@<N>"` pin, resolved
  // via `@nextbot/knowledge`'s `resolveKnowledgeCollectionPin` — first unresolvable
  // collection name fails the save, exactly like an unresolvable skill pin above)
  // BEFORE this version is ever persisted. Both stay `undefined`/`null` for the
  // overwhelming majority of versions that declare no `spec.knowledge` at all — a
  // non-knowledge-scoped version never resolves (or pays the cost of resolving) a
  // planner route it will never call.
  let plannerRouteVersionId: string | undefined;
  let knowledgeConfig: ResolvedAgentKnowledgeConfig | undefined;
  if (validatedArtifact.spec.knowledge) {
    const plannerRoute = await resolveOrSynthesizeRouteVersionForKey(ctx, validatedArtifact.spec.plannerRoute ?? "chat.router");
    plannerRouteVersionId = plannerRoute.id;

    const resolvedCollections = await Promise.all(validatedArtifact.spec.knowledge.collections.map((pin) => resolveKnowledgeCollectionPin(ctx, pin)));
    const strategyMap = { vector: "Vector", local: "GraphLocal", global: "GraphGlobal", hybrid: "Hybrid", auto: "auto" } as const;
    // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — resolve this
    // version's own declared `aclScope` (if any) into the SAME opaque tag-hash shape
    // `knowledge_source.acl_tags` carries, computed ONCE here (immutable, like every
    // other pin on this row). `visibility: "Tenant"` is always included — a
    // knowledge-scoped agent always sees at least a tenant's broadly-visible content
    // by default; only Restricted content requires an explicit `aclScope` grant.
    const aclTags = deriveAclTags(ctx.tenantId, {
      visibility: "Tenant",
      roleIds: validatedArtifact.spec.knowledge.aclScope?.roleIds,
      capabilityGroupIds: validatedArtifact.spec.knowledge.aclScope?.capabilityGroupIds,
      tags: validatedArtifact.spec.knowledge.aclScope?.tags ?? [],
    });
    knowledgeConfig = {
      collectionIds: resolvedCollections.map((c) => c.collectionId),
      strategy: strategyMap[validatedArtifact.spec.knowledge.strategy],
      maxHops: validatedArtifact.spec.knowledge.maxHops,
      maxExpansions: validatedArtifact.spec.knowledge.maxExpansions,
      minCitations: validatedArtifact.spec.knowledge.minCitations,
      refuseWhenUngrounded: validatedArtifact.spec.knowledge.refuseWhenUngrounded,
      budget: validatedArtifact.spec.knowledge.budget,
      aclTags,
      callerTrustLevel: validatedArtifact.spec.knowledge.callerTrustLevel ?? "SemiTrusted",
    };
  }

  return insertAgentDefinitionVersion(ctx, {
    agentDefinitionId,
    version: input.version,
    graphType: input.graphType ?? validatedArtifact.spec.graphType,
    definitionYaml: yamlContent,
    definitionHash,
    gitCommitSha: commitSha,
    modelRouteKey: input.modelRouteKey,
    modelRouteVersionId: routeVersion.id,
    createdByUserId,
    skillPins,
    plannerRouteVersionId,
    knowledgeConfig,
    upgradeSourceVersionId: upgradeProvenance?.upgradeSourceVersionId,
    upgradedSkillVersionId: upgradeProvenance?.upgradedSkillVersionId,
  });
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06) — reads a version's
 * resolved knowledge-agent config, the same "small accessor" shape
 * `getVersionToolPolicy` already established for `toolPolicy` — the ONE thing
 * `orchestration/application/turn-pipeline.ts` needs to decide whether a turn's
 * "reply" action should route through the bounded retrieval agent instead of the
 * model's own free-text `replyText`. `null` for every non-knowledge-scoped version.
 */
export async function getVersionKnowledgeConfig(
  ctx: TenantContext,
  agentDefinitionVersionId: string,
): Promise<{ plannerRouteVersionId: string; answerRouteVersionId: string; knowledgeConfig: ResolvedAgentKnowledgeConfig } | null> {
  const version = await getAgentDefinitionVersion(ctx, agentDefinitionVersionId);
  if (!version.plannerRouteVersionId || !version.knowledgeConfig || !version.modelRouteVersionId) return null;
  return { plannerRouteVersionId: version.plannerRouteVersionId, answerRouteVersionId: version.modelRouteVersionId, knowledgeConfig: version.knowledgeConfig };
}

/** U7 fix — resolves a version's actual last-eval-run status (`null` if it has never
 * run), never faking a status for a `lastEvalRunId` that's missing. */
async function resolveLastEvalRunStatus(ctx: TenantContext, lastEvalRunId: string | null): Promise<AgentDefinitionVersionView["lastEvalRunStatus"]> {
  if (!lastEvalRunId) return null;
  const run = await getEvalRun(ctx, lastEvalRunId);
  return run?.status ?? null;
}

export async function listVersions(ctx: TenantContext, agentDefinitionId: string, callingUserId: string | null): Promise<AgentDefinitionVersionView[]> {
  const versions = await listAgentDefinitionVersions(ctx, agentDefinitionId);
  return Promise.all(
    versions.map(async (v) => ({
      ...v,
      _allowedTransitions: await getAllowedTransitionsForVersion(ctx, v.id, callingUserId),
      lastEvalRunStatus: await resolveLastEvalRunStatus(ctx, v.lastEvalRunId),
      _emergencyRollbackEligible: await hasEverBeenProductionInHistory(ctx, v.id),
    })),
  );
}

export async function getVersion(ctx: TenantContext, versionId: string, callingUserId: string | null): Promise<AgentDefinitionVersionView> {
  const version = await getAgentDefinitionVersion(ctx, versionId);
  const _allowedTransitions = await getAllowedTransitionsForVersion(ctx, versionId, callingUserId);
  const lastEvalRunStatus = await resolveLastEvalRunStatus(ctx, version.lastEvalRunId);
  const _emergencyRollbackEligible = await hasEverBeenProductionInHistory(ctx, versionId);
  return { ...version, _allowedTransitions, lastEvalRunStatus, _emergencyRollbackEligible };
}

/** FR-AGT-02 — a real diff between two versions' commits via the provider's compare
 * API (never a local `git diff`, ADR-0009). Both versions must have a `git_commit_sha`
 * (a pre-Decision-2 row / platform-shared definition with none cannot be diffed this
 * way — out of scope, this codebase has no such rows since Decision 2 predates BL-07's
 * implementation). */
export async function diffVersions(ctx: TenantContext, versionAId: string, versionBId: string): Promise<GitDiffResult> {
  const [versionA, versionB] = await Promise.all([getAgentDefinitionVersion(ctx, versionAId), getAgentDefinitionVersion(ctx, versionBId)]);
  if (!versionA.gitCommitSha || !versionB.gitCommitSha) {
    throw new Error("Both versions must have a git commit to diff.");
  }
  return diffAgentDefinitionVersions(ctx, { baseSha: versionA.gitCommitSha, headSha: versionB.gitCommitSha });
}

/**
 * ADR-0016 (FR-AGT-19, BL-31) — the Git-independent structural-diff baseline: works
 * unconditionally on any two versions' stored `definitionYaml`, regardless of whether
 * either has a `git_commit_sha`. This is a genuinely separate endpoint from
 * `diffVersions` above (never blended — ADR-0016 §2.2), and it never throws
 * `GIT_CONNECTION_UNAVAILABLE` or any other Git-shaped error, because it has no Git
 * dependency at all: it reads two already-persisted `definition_yaml` columns and
 * calls `@nextbot/yaml-diff`'s pure `diffArtifact`, nothing else.
 */
export async function structuralDiffVersions(ctx: TenantContext, versionAId: string, versionBId: string): Promise<ChangeSet> {
  const [versionA, versionB] = await Promise.all([getAgentDefinitionVersion(ctx, versionAId), getAgentDefinitionVersion(ctx, versionBId)]);
  return diffArtifact("AgentVersion", versionA.definitionYaml, versionB.definitionYaml);
}

/**
 * FR-AGT-03 — opens a real PR/MR against the tenant's connected repo for this
 * version's commit, and records the PR/MR number + `Open` status on the version row.
 * **Never fakes a PR/MR** (ADR-0009's 2026-08-23 amendment §7(c)): PR/MR review stays
 * strictly Git-only. When there is nothing to open a review against — either this
 * version has no commit at all (it was created with no Git connection configured), or
 * a connection existed at commit time but has since been disconnected
 * (`GitConnectionNotFoundError`) — this returns a typed "not applicable" result rather
 * than throwing, since the in-app reviewer!=author check (`promotion-policy.ts`) is
 * the documented approval mechanism for that case, not an error state. A **genuine**
 * failure against a connection that is configured (`GitConnectionUnavailableError`, or
 * any other unexpected error) is re-thrown as-is, distinct from the two cases above.
 */
export async function submitVersionForReview(ctx: TenantContext, versionId: string): Promise<{ prNumber: number | null; reason?: "git-not-connected" }> {
  const version = await getAgentDefinitionVersion(ctx, versionId);
  if (!version.gitCommitSha) {
    // Nothing was ever committed for this version (no Git connection at creation
    // time) — there is no commit to open a PR/MR against.
    return { prNumber: null, reason: "git-not-connected" };
  }
  try {
    const { number } = await openAgentDefinitionReview(ctx, { agentDefinitionId: version.agentDefinitionId, version: version.version, commitSha: version.gitCommitSha });
    await setVersionGitPrInfo(ctx, versionId, { gitPrNumber: number, gitPrStatus: "Open" });
    return { prNumber: number };
  } catch (err) {
    if (err instanceof GitConnectionNotFoundError) {
      // The connection was disconnected sometime between this version's commit and
      // this call — same graceful "nothing to review against" outcome as above.
      return { prNumber: null, reason: "git-not-connected" };
    }
    throw err;
  }
}

/** Binds (or re-binds) the eval suite a version's promotion gate checks against
 * (LLD §3.10: `eval_suite_id` "required non-null before `Approved`"). */
export async function bindEvalSuite(ctx: TenantContext, versionId: string, evalSuiteId: string): Promise<void> {
  await setVersionEvalBinding(ctx, versionId, { evalSuiteId });
}

/**
 * Phase 7 (client-feedback-batch item 6) — records that a real sandbox conversation
 * turn genuinely completed against this exact version, so the `Approved ->
 * Production` promotion gate (`promotion-policy.ts`) can require it. Called from
 * `apps/gateway`'s composition-root turn-pipeline adapter only when a
 * server-verified sandbox-preview session's message actually produced a completed
 * `agent_run` (i.e. `runTurnPipeline` returned a non-null `runId`) — never merely
 * because a preview session/iframe was opened. Best-effort by design at the call
 * site (a bookkeeping failure here must never break the customer-visible reply);
 * this function itself is a plain, idempotent write.
 */
export async function recordSandboxTest(ctx: TenantContext, versionId: string): Promise<void> {
  await recordAgentDefinitionVersionSandboxTest(ctx, versionId);
}

/** Just the slice of a version's artifact `orchestration`'s turn pipeline actually
 * needs on every live turn (Phase 17, client-feedback-batch capability-group
 * enforcement). */
export interface VersionToolPolicy {
  /** Real `capability_group.name` values (Design Studio picker, Phase 10) — an empty
   * array means "no capability-group restriction configured", matching the Phase 1
   * seed data's "Support Assistant" and every other agent version that predates this
   * enforcement work. */
  capabilityGroups: string[];
}

/**
 * A lightweight, hot-path-friendly read of one version's `spec.toolPolicy.
 * capabilityGroups` — deliberately NOT `getVersion()` above, which also computes
 * `_allowedTransitions` and the last-eval-run status via extra queries the turn
 * pipeline (invoked on every customer message) has no use for and shouldn't pay for.
 *
 * Parses `definitionYaml` defensively: every version's artifact was validated against
 * `AgentDefinitionArtifactSchema` at write time (`createAgentDefinitionVersion`), so an
 * unparsable YAML or a missing/malformed `toolPolicy.capabilityGroups` here should
 * never happen in practice — but if it somehow did, this degrades to the same "no
 * restriction configured" empty-array default described above (logged, never thrown)
 * rather than failing the whole turn over a bookkeeping read. This does NOT weaken
 * enforcement: `permission-resolver.ts`'s own `capability_group_not_permitted` check
 * is the real, independent authorization backstop regardless of what this catalog
 * pre-filter resolves to.
 */
export async function getVersionToolPolicy(ctx: TenantContext, versionId: string): Promise<VersionToolPolicy> {
  const version = await getAgentDefinitionVersion(ctx, versionId);
  try {
    const parsed = yaml.load(version.definitionYaml) as { spec?: { toolPolicy?: { capabilityGroups?: unknown } } } | null;
    const raw = parsed?.spec?.toolPolicy?.capabilityGroups;
    if (!Array.isArray(raw)) return { capabilityGroups: [] };
    return { capabilityGroups: raw.filter((g): g is string => typeof g === "string") };
  } catch (err) {
    console.error(
      `[agent-platform] getVersionToolPolicy: failed to parse definitionYaml for version ${versionId} — treating as no capability-group restriction.`,
      err,
    );
    return { capabilityGroups: [] };
  }
}

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-05) — the version's declared
 * `spec.trustLevel` (Phase 12/FR-AGT-14's field), the input to
 * "the masking-context matrix is re-evaluated at every hand-off boundary, keyed to
 * the RECEIVING agent's declared trust level".
 *
 * Fails **closed**: a version that declares no `trustLevel`, or whose YAML cannot be
 * parsed at all, resolves to `"Untrusted"` — the strictest level, so an undeclared
 * or unreadable specialist receives the MOST masked transcript, never the least.
 * This deliberately differs from `getVersionToolPolicy`'s "no restriction" fallback
 * directly above: an absent capability-group list genuinely means "unrestricted",
 * whereas an absent trust level must never mean "trusted".
 *
 * Mirrors `getVersionToolPolicy`'s shape exactly (same accessor pattern, same
 * parse-failure logging) rather than introducing a second way to read a version's
 * spec.
 */
export async function getVersionTrustLevel(ctx: TenantContext, versionId: string): Promise<"Trusted" | "SemiTrusted" | "Untrusted"> {
  const version = await getAgentDefinitionVersion(ctx, versionId);
  try {
    const parsed = yaml.load(version.definitionYaml) as { spec?: { trustLevel?: unknown } } | null;
    const raw = parsed?.spec?.trustLevel;
    if (raw === "Trusted" || raw === "SemiTrusted" || raw === "Untrusted") return raw;
    return "Untrusted";
  } catch (err) {
    console.error(
      `[agent-platform] getVersionTrustLevel: failed to parse definitionYaml for version ${versionId} — failing closed to 'Untrusted'.`,
      err,
    );
    return "Untrusted";
  }
}

export function serializeArtifactToYaml(artifact: AgentDefinitionArtifact): string {
  return yaml.dump(artifact);
}

export function parseArtifactFromYaml(text: string): unknown {
  return yaml.load(text);
}
