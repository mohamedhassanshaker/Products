/**
 * Save `/orchestrator`'s router configuration form — the use case that makes B4's
 * execution mode, agent-combination scope, ceilings and merge/conflict policy real,
 * editable settings instead of a read-only diagnostic view.
 *
 * Every validation rule here mirrors a real `CK_RouterConfigs_*` constraint
 * (`prisma/sql/001_constraints.sql`), confirmed by reading the live constraint text
 * directly rather than trusting `docs/api.md`'s own speculative numbers (which understate
 * `maxHops`'s real range and omit `maxLoopIterations` entirely) — the point of validating
 * here at all is a clean `{ok:false, reason}` instead of a raw SQL constraint-violation
 * error reaching the caller.
 */

import type {
  RouterConfigRepository,
  RouterConfigRow,
  UpdateRouterConfigInput as RepositoryUpdateInput,
} from "../ports/router-config-repository.js";
import type { PublishedAgentPort } from "../ports/published-agent-port.js";

export interface UpdateRouterConfigInput {
  readonly executionMode: RepositoryUpdateInput["executionMode"];
  readonly routingStrategy: RepositoryUpdateInput["routingStrategy"];
  readonly agentSelectionScope: RepositoryUpdateInput["agentSelectionScope"];
  readonly agentScopeListJson: string | null;
  readonly maxHops: number;
  readonly maxLoopIterations: number;
  readonly costCeilingTokens: number;
  readonly costCeilingMicroAed: number;
  readonly conflictResolution: RepositoryUpdateInput["conflictResolution"];
  readonly responseMergePolicy: RepositoryUpdateInput["responseMergePolicy"];
  readonly fallbackAgentId: string | null;
  readonly minRoutingConfidence: number;
}

export type UpdateRouterConfigReason =
  | "orchestration.max_hops_out_of_range"
  | "orchestration.max_loop_iterations_out_of_range"
  | "orchestration.cost_ceiling_must_be_positive"
  | "orchestration.parallel_requires_overlap_resolving_merge_policy"
  | "orchestration.supervisor_worker_requires_min_hops"
  | "orchestration.explicit_list_requires_non_empty_agent_list"
  | "orchestration.explicit_list_agents_must_be_published"
  | "orchestration.agent_scope_list_must_be_valid_json_array"
  | "orchestration.min_routing_confidence_out_of_range";

export type UpdateRouterConfigResult =
  | { readonly ok: true; readonly config: RouterConfigRow }
  | { readonly ok: false; readonly reason: UpdateRouterConfigReason };

export interface UpdateRouterConfigDeps {
  readonly routerConfig: RouterConfigRepository;
  readonly agents: PublishedAgentPort;
}

/** `CK_RouterConfigs_maxHops`. */
const MAX_HOPS_RANGE = { min: 1, max: 10 } as const;
/** `CK_RouterConfigs_maxHops` (same constraint, second column). */
const MAX_LOOP_ITERATIONS_RANGE = { min: 1, max: 20 } as const;
/** `CK_RouterConfigs_confidence`. */
const MIN_ROUTING_CONFIDENCE_RANGE = { min: 0, max: 1 } as const;
/** `SupervisorWorker`'s own `max_secondary = 2` (`process_turn.py`) needs 1 primary +
 *  up to 2 secondary hops of headroom, or `hop_ceiling_reached` truncates a legitimate
 *  turn immediately. */
const SUPERVISOR_WORKER_MIN_HOPS = 3;

export class UpdateRouterConfig {
  constructor(private readonly deps: UpdateRouterConfigDeps) {}

  async execute(input: UpdateRouterConfigInput): Promise<UpdateRouterConfigResult> {
    if (input.maxHops < MAX_HOPS_RANGE.min || input.maxHops > MAX_HOPS_RANGE.max) {
      return { ok: false, reason: "orchestration.max_hops_out_of_range" };
    }
    if (
      input.maxLoopIterations < MAX_LOOP_ITERATIONS_RANGE.min ||
      input.maxLoopIterations > MAX_LOOP_ITERATIONS_RANGE.max
    ) {
      return { ok: false, reason: "orchestration.max_loop_iterations_out_of_range" };
    }
    if (input.costCeilingTokens <= 0 || input.costCeilingMicroAed <= 0) {
      return { ok: false, reason: "orchestration.cost_ceiling_must_be_positive" };
    }
    if (
      input.minRoutingConfidence < MIN_ROUTING_CONFIDENCE_RANGE.min ||
      input.minRoutingConfidence > MIN_ROUTING_CONFIDENCE_RANGE.max
    ) {
      return { ok: false, reason: "orchestration.min_routing_confidence_out_of_range" };
    }
    if (
      (input.executionMode === "Parallel" || input.executionMode === "SupervisorWorker") &&
      input.responseMergePolicy === "ConcatenateInOrder"
    ) {
      // `merge_replies()` (apps/ai domain/orchestration.py) only ever runs with more than
      // one reply outside Sequential, and `ConcatenateInOrder` genuinely duplicates
      // overlapping content with no dedup/rewrite step — a real, not merely stylistic,
      // failure mode for these two modes specifically.
      return { ok: false, reason: "orchestration.parallel_requires_overlap_resolving_merge_policy" };
    }
    if (input.executionMode === "SupervisorWorker" && input.maxHops < SUPERVISOR_WORKER_MIN_HOPS) {
      return { ok: false, reason: "orchestration.supervisor_worker_requires_min_hops" };
    }

    // `CK_RouterConfigs_scopeListPaired`/`_agentScopeListJson_isJson`: ExplicitList iff a
    // non-null, valid JSON array; every other scope requires null. Normalized here rather
    // than rejecting a stray non-null value left over from a UI state change — that is a
    // UI artifact, not a real user error.
    let agentScopeListJson: string | null = null;
    if (input.agentSelectionScope === "ExplicitList") {
      let parsed: unknown;
      try {
        parsed = input.agentScopeListJson === null ? null : JSON.parse(input.agentScopeListJson);
      } catch {
        return { ok: false, reason: "orchestration.agent_scope_list_must_be_valid_json_array" };
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every((id): id is string => typeof id === "string" && id.length > 0)
      ) {
        return { ok: false, reason: "orchestration.explicit_list_requires_non_empty_agent_list" };
      }

      // Unlike the AI-side pure filter (which safely drops a stale/unpublished id at read
      // time), this save path is where a human believes they are building an N-agent
      // pipeline — silently accepting a bad id here would make the saved config lie to the
      // person who just configured it.
      const published = await this.deps.agents.listPublished();
      const publishedIds = new Set(published.map((agent) => agent.id));
      if (!parsed.every((id) => publishedIds.has(id))) {
        return { ok: false, reason: "orchestration.explicit_list_agents_must_be_published" };
      }

      agentScopeListJson = JSON.stringify(parsed);
    }

    const config = await this.deps.routerConfig.updateTenantConfig({
      executionMode: input.executionMode,
      routingStrategy: input.routingStrategy,
      agentSelectionScope: input.agentSelectionScope,
      agentScopeListJson,
      maxHops: input.maxHops,
      maxLoopIterations: input.maxLoopIterations,
      costCeilingTokens: input.costCeilingTokens,
      costCeilingMicroAed: input.costCeilingMicroAed,
      conflictResolution: input.conflictResolution,
      responseMergePolicy: input.responseMergePolicy,
      fallbackAgentId: input.fallbackAgentId,
      minRoutingConfidence: input.minRoutingConfidence,
    });
    return { ok: true, config };
  }
}
