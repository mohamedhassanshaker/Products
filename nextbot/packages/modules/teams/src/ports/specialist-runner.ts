import type { DelegationChainEntry } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-10, LLD §14.7.3 step 5) —
 * how a specialist member is actually executed once the hop has been authorised,
 * guardrail-screened and re-masked.
 *
 * The production implementation
 * (`infrastructure/turn-pipeline-specialist-runner.ts`) runs the member's pinned
 * agent version through `@nextbot/orchestration`'s EXISTING turn pipeline, threading
 * the `delegationContext` below so any Tier-3 tool call the specialist makes — at
 * any depth — takes the ordinary path to the Approval Queue carrying the full chain
 * (FR-ORC-04). This is a port rather than a hard call purely so the executor's own
 * multi-hop/thrash/fallback/budget logic can be exercised deterministically without
 * standing up a model provider; the port's production implementation is real, ships
 * in this module, and is what every non-executor test uses.
 */

export interface SpecialistRunInput {
  /** The member's pinned `agent_definition_version.id`. */
  definitionVersionId: string;
  /** The already-guardrail-screened, already-re-masked task text (LLD §14.7.3
   * steps 3 and 4 both run BEFORE this port is called — the runner must never
   * receive raw supervisor context). */
  task: string;
  conversationId: string | null;
  /** Threaded into `runTurnPipeline`, which threads it into `runTierEngine`. */
  delegationContext: { agentRunId: string; chain: DelegationChainEntry[] };
}

/**
 * Mirrors the `AgentAsTool` output schema LLD §14.7.1 pins
 * (`{outcome: 'answered'|'not_mine'|'escalate', text?, citations?}`) so the trace
 * viewer and the sandbox tester read a delegation exactly like any other tool call.
 *
 * `'not_mine'` is a FIRST-CLASS result (FR-ORC-10), not an error: a specialist
 * invoked outside its actual competence says so, the supervisor may re-route once,
 * and the hop is traced with the distinct `NotMine` outcome.
 */
export interface SpecialistRunResult {
  outcome: "answered" | "not_mine" | "escalate";
  text?: string;
  citations?: unknown[];
  tokensIn: number;
  tokensOut: number;
  /** Decimal string — added to the run's `consumed.usd`, which is fed to the Phase 6
   * evaluator's own cost ceiling. */
  costUsd: string;
  /** Set when the specialist could not run at all (its pinned version is
   * deprecated, its backing route/connector is offline). Triggers FR-ORC-10's
   * fallback path — never a silent supervisor answer. */
  unavailableReason?: string;
  /**
   * FR-ORC-04/07 — the specialist asked to SUB-DELEGATE: it selected another
   * member's `AgentAsTool` catalog entry during its own turn. The executor performs
   * that hop as a real CHILD of this one (`depth + 1`, `parent_delegation_event_id`
   * set), re-running the whole seven-step sequence at the new boundary — the Phase 6
   * evaluator's intersection against this specialist's OWN already-narrowed
   * effective scope (so the child can only ever be narrower), the thrash guard, the
   * injection screen, and the PII re-mask keyed to the CHILD's trust level.
   *
   * This is what makes `maxDepth` a live ceiling rather than a decorative field: a
   * chain of specialists is bounded by the evaluator's own step-2 depth check at
   * every hop.
   */
  delegateTo?: { toolId: string; task: string };
}

export interface SpecialistRunner {
  run(input: SpecialistRunInput): Promise<SpecialistRunResult>;
}
