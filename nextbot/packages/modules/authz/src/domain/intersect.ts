import { Value } from "@sinclair/typebox/value";
import {
  PermissionIntersectionInputSchema,
  ScopeDescriptorSchema,
  type DenyReasonValue,
  type PermissionIntersectionInput,
  type PermissionIntersectionResult,
  type ScopeDescriptor,
  type ScopeOriginValue,
} from "@nextbot/contracts";
import { DIMENSIONS, TOP, latticeValuesEqual, tierRank, type EffectiveLattice, type LatticeFields } from "./scope-lattice.js";
import { hashScopeInput } from "./scope-hash.js";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012 §2.3, LLD §14.2.3) — THE
 * permission-intersection evaluator. A **pure function over explicit inputs**, no
 * I/O, no database (`no-db-inside-domain`, dependency-cruiser). This is the single
 * implementation of FR-ORC-02/FR-SEC-08:
 *
 * > effective scope = caller scope ∩ artifact scope ∩ tenant policy. Composition
 * > narrows. It never unions, and there is no flag that makes it union.
 *
 * Every edge case in LLD §14.2.4's table (E1–E14) is a required unit test in
 * `intersect.test.ts` — this function's doc comments below cross-reference each
 * one at the exact line implementing it.
 */

interface Trace {
  dimension: string;
  before: unknown;
  after: unknown;
  narrowedBy: ScopeOriginValue | null;
  narrowedByLabel: string | null;
}

function deny(reason: DenyReasonValue, detail: string, trace: Trace[], scopeHash: string): PermissionIntersectionResult {
  return { decision: "Deny", denyReason: reason, denyDetail: detail, trace, scopeHash };
}

/**
 * `evaluate()` — step 0-6 of LLD §14.2.3, transcribed 1:1.
 *
 * Callers OUTSIDE this module must never call this directly — use
 * `evaluateOrDeny()` (`application/evaluate-or-deny.ts`), which wraps this in a
 * try/catch per E11. `input` is typed `unknown` deliberately: the whole point of
 * step 0 is that a caller's compile-time `PermissionIntersectionInput` type is not
 * trusted at runtime (a stored `scope_json` from an older/newer artifact version
 * can carry a shape TypeScript never sees).
 */
export function evaluate(input: unknown): PermissionIntersectionResult {
  // ---- Step 0: structural validation (fail-closed before any lattice work) ----
  // `additionalProperties: false` on ScopeDescriptorSchema means an unrecognised
  // dimension name is caught HERE, not silently ignored (E2).
  if (!Value.Check(PermissionIntersectionInputSchema, input)) {
    const scopeHash = safeHash(input);
    return deny("SCOPE_MALFORMED", firstValidationError(input), [], scopeHash);
  }
  const validated = input as PermissionIntersectionInput;
  const scopeHash = hashScopeInput({
    tenantPolicy: validated.tenantPolicy,
    chain: validated.chain,
    requested: validated.requested,
    tenantResidencyRegion: validated.tenantResidencyRegion,
  });

  if (validated.tenantPolicy.origin !== "TenantPolicy") {
    return deny("SCOPE_MALFORMED", "tenantPolicy.origin must be 'TenantPolicy'", [], scopeHash);
  }
  // E5: there is no implicit ⊤ system caller — `chain[0]` must be a real artifact
  // scope, never the tenant floor sneaking in as if it were the first hop.
  if (validated.chain[0]!.origin === "TenantPolicy") {
    return deny("SCOPE_MALFORMED", "chain[0].origin must not be 'TenantPolicy'", [], scopeHash);
  }

  // ---- Step 1: fold — associative/commutative on every dimension (asserted by
  // intersect.test.ts's property test); chain order affects only `narrowedBy`
  // trace attribution, never the decision. ----
  const levels: ScopeDescriptor[] = [validated.tenantPolicy, ...validated.chain];
  const eff: EffectiveLattice = { ...TOP };
  const trace: Trace[] = [];
  for (const level of levels) {
    for (const dim of DIMENSIONS) {
      const before = eff[dim.name];
      const levelValue = (level as LatticeFields)[dim.name];
      const after = dim.meet(before, levelValue === undefined ? TOP[dim.name] : levelValue);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DIMENSIONS is a data-driven table over a heterogeneous record; each meet fn is individually typed.
      (eff as any)[dim.name] = after;
      const narrowed = !latticeValuesEqual(before, after);
      trace.push({
        dimension: dim.name,
        before,
        after,
        narrowedBy: narrowed ? level.origin : null,
        narrowedByLabel: narrowed ? level.originLabel : null,
      });
    }
  }

  // ---- Step 2: budget/depth ceilings (independent of `requested`) ----
  if (validated.depth > (eff.budget.maxDepth ?? Infinity)) {
    return deny("DELEGATION_DEPTH_EXCEEDED", `depth ${validated.depth} > maxDepth ${eff.budget.maxDepth}`, trace, scopeHash);
  }
  const consumed = validated.consumed;
  if (consumed) {
    if (eff.budget.maxDelegations !== undefined && consumed.delegations >= eff.budget.maxDelegations) {
      return deny("DELEGATION_COUNT_EXCEEDED", `delegations ${consumed.delegations} >= maxDelegations ${eff.budget.maxDelegations}`, trace, scopeHash);
    }
    if (eff.budget.maxFanOut !== undefined && consumed.fanOut >= eff.budget.maxFanOut) {
      return deny("FAN_OUT_EXCEEDED", `fanOut ${consumed.fanOut} >= maxFanOut ${eff.budget.maxFanOut}`, trace, scopeHash);
    }
    if (eff.budget.maxSteps !== undefined && consumed.steps >= eff.budget.maxSteps) {
      return deny("STEP_BUDGET_EXCEEDED", `steps ${consumed.steps} >= maxSteps ${eff.budget.maxSteps}`, trace, scopeHash);
    }
    if (eff.budget.usdPerTurn !== undefined && consumed.usd >= eff.budget.usdPerTurn) {
      return deny("COST_BUDGET_EXCEEDED", `usd ${consumed.usd} >= usdPerTurn ${eff.budget.usdPerTurn}`, trace, scopeHash);
    }
    if (eff.budget.seconds !== undefined && consumed.seconds >= eff.budget.seconds) {
      return deny("WALL_CLOCK_BUDGET_EXCEEDED", `seconds ${consumed.seconds} >= budget.seconds ${eff.budget.seconds}`, trace, scopeHash);
    }
  }

  // `eff`'s fields are runtime-narrowed subsets of their real literal domains
  // (e.g. `channelTypes` only ever contains real `ChannelTypeValue`s, since every
  // value that reached it came from a validated `ScopeDescriptor`) — `Effective
  // Lattice` types them more loosely (plain `string[]`) purely so the
  // dimension-generic fold loop above doesn't need one bespoke type per
  // dimension; this cast reconciles that back to the real, narrower contract
  // type for the value actually returned to callers.
  //
  // **Round-trippability (found by Phase 14/BL-46's adversarial delegation
  // testing).** `PermissionIntersectionResult.effectiveScope`'s own contract is
  // "the caller MUST pass this (not its own scope) to the next hop" — which the
  // delegation executor does literally, appending it as the next hop's chain level.
  // That only works if the returned value is itself a VALID `ScopeDescriptor`
  // input. It was not: `minRequiredTier`'s lattice top is `null` (see `TOP`), while
  // `ScopeDescriptorSchema` types the field as an OPTIONAL `ApprovalTier` with no
  // `null` member — so feeding an unconstrained `effectiveScope` straight back in
  // failed step 0's structural check and fail-closed `SCOPE_MALFORMED`-denied every
  // multi-hop delegation. Omitting the field when it is at top is the correct fix
  // (E3: an omitted dimension IS the top), and it is exactly equivalent for the
  // fold, since `meetMaxTierOrNull(null, x) === x`.
  const { minRequiredTier, ...restOfEff } = eff;
  const effectiveScopeDescriptor = {
    ...restOfEff,
    ...(minRequiredTier === null ? {} : { minRequiredTier }),
    origin: levels[levels.length - 1]!.origin,
    originId: levels[levels.length - 1]!.originId,
    originLabel: levels[levels.length - 1]!.originLabel,
  } as unknown as ScopeDescriptor;

  // ---- Step 3: no `requested` -> "compute the scope, don't authorise a call yet" ----
  const requested = validated.requested;
  if (!requested) {
    return { decision: "Allow", effectiveScope: effectiveScopeDescriptor, trace, scopeHash };
  }

  // ---- Step 4: requested-capability checks (each names the dimension + origin) ----

  // 4a. Deny always wins regardless of reachability path (E13).
  if (requested.toolId && eff.deniedToolIds.includes(requested.toolId)) {
    return deny("TOOL_EXPLICITLY_DENIED", `toolId ${requested.toolId} is in deniedToolIds`, trace, scopeHash);
  }

  // 4b. Tool reachability: Allow if EITHER the tool id or its capability group is
  // in scope (or either dimension is still `⊤`). E4: `toolIds: '*'` caps to the
  // caller's own set by construction (meetStarOrArray never widens past `'*'`).
  if (requested.toolId !== undefined || requested.toolCapabilityGroupId !== undefined) {
    const toolIdReachable = eff.toolIds === "*" || (requested.toolId !== undefined && eff.toolIds.includes(requested.toolId));
    const groupReachable =
      eff.capabilityGroupIds === "*" ||
      (requested.toolCapabilityGroupId !== undefined && eff.capabilityGroupIds.includes(requested.toolCapabilityGroupId));
    if (!toolIdReachable && !groupReachable) {
      const bothEmpty = Array.isArray(eff.toolIds) && eff.toolIds.length === 0 && Array.isArray(eff.capabilityGroupIds) && eff.capabilityGroupIds.length === 0;
      return deny(
        bothEmpty ? "EMPTY_CAPABILITY_INTERSECTION" : "TOOL_NOT_IN_SCOPE",
        `toolId ${requested.toolId ?? "(none)"} / capabilityGroupId ${requested.toolCapabilityGroupId ?? "(none)"} not reachable via toolIds=${JSON.stringify(eff.toolIds)} or capabilityGroupIds=${JSON.stringify(eff.capabilityGroupIds)}`,
        trace,
        scopeHash,
      );
    }
  }

  // 4c.
  if (requested.toolRwClass !== undefined && !eff.rwClasses.includes(requested.toolRwClass)) {
    return deny("RW_CLASS_NOT_PERMITTED", `toolRwClass ${requested.toolRwClass} not in rwClasses=${JSON.stringify(eff.rwClasses)}`, trace, scopeHash);
  }

  // 4d.
  if (requested.knowledgeCollectionIds !== undefined && eff.knowledgeCollectionIds !== "*") {
    const allowed = new Set(eff.knowledgeCollectionIds);
    const missing = requested.knowledgeCollectionIds.filter((id) => !allowed.has(id));
    if (missing.length > 0) {
      return deny("KNOWLEDGE_COLLECTION_NOT_IN_SCOPE", `knowledgeCollectionIds ${JSON.stringify(missing)} not in scope`, trace, scopeHash);
    }
  }

  // 4e.
  if (requested.channelType !== undefined && eff.channelTypes !== "*" && !eff.channelTypes.includes(requested.channelType)) {
    return deny("CHANNEL_NOT_IN_SCOPE", `channelType ${requested.channelType} not in channelTypes=${JSON.stringify(eff.channelTypes)}`, trace, scopeHash);
  }

  // 4f.
  if (requested.environment !== undefined && eff.environments !== "*" && !eff.environments.includes(requested.environment)) {
    return deny("ENVIRONMENT_NOT_IN_SCOPE", `environment ${requested.environment} not in environments=${JSON.stringify(eff.environments)}`, trace, scopeHash);
  }

  // 4g. Residency — see `PermissionIntersectionInputSchema.tenantResidencyRegion`'s
  // doc comment (contracts/src/authz.ts) for why this field exists: the LLD's own
  // step 4g pseudocode compares `requested.targetRegion` against "the tenant
  // residency region" but never says how the evaluator learns that value, since
  // it isn't itself a lattice dimension. Only checked when the caller supplied
  // BOTH values — omitting either means "not applicable to this call".
  if (
    requested.targetRegion !== undefined &&
    validated.tenantResidencyRegion !== undefined &&
    requested.targetRegion !== validated.tenantResidencyRegion &&
    !eff.allowOutOfRegionInference
  ) {
    return deny(
      "RESIDENCY_VIOLATION",
      `targetRegion ${requested.targetRegion} != tenant residency region ${validated.tenantResidencyRegion} and allowOutOfRegionInference is false`,
      trace,
      scopeHash,
    );
  }

  // ---- Step 5: tier resolution — NEVER a deny (E6). ----
  // requested.toolApprovalTier is the tool's OWN inherent tier requirement; a
  // scope trying to *lower* it is ignored by construction because this is a `max`
  // (E7) — `eff.minRequiredTier` can only ever raise the floor, never lower it.
  const baseTier = requested.toolApprovalTier ?? "Tier1";
  const requiredTier = eff.minRequiredTier && tierRank(eff.minRequiredTier) > tierRank(baseTier) ? eff.minRequiredTier : baseTier;
  const requiresApproval = tierRank(requiredTier) > tierRank(eff.autonomyCeiling);

  // ---- Step 6 ----
  return {
    decision: "Allow",
    effectiveScope: effectiveScopeDescriptor,
    requiredTier: requiredTier as PermissionIntersectionResult["requiredTier"],
    requiresApproval,
    trace,
    scopeHash,
  };
}

function safeHash(input: unknown): string {
  try {
    return hashScopeInput(input);
  } catch {
    return hashScopeInput({ malformed: true });
  }
}

function firstValidationError(input: unknown): string {
  const errors = [...Value.Errors(PermissionIntersectionInputSchema, input)];
  const first = errors[0];
  return first ? `${first.path || "(root)"}: ${first.message}` : "input failed structural validation";
}

// Re-exported so `application/evaluate-or-deny.ts` (and tests) can validate a
// standalone ScopeDescriptor without re-declaring the schema import.
export { ScopeDescriptorSchema };
