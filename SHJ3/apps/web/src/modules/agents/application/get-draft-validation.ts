/**
 * Structural completeness check for B3 step 10 (Publish) — "can this draft be published at
 * all", not "is this agent good enough to publish".
 *
 * Deliberately minimal: this checks only the two structural prerequisites B2/B3's current
 * data model can express —
 *
 *  - **"identity"** — the agent has a non-empty `name` (`agents.getAgentDetail`).
 *  - **"channels"** — at least one enabled channel binding exists on this version
 *    (`bindings.listChannelBindings`).
 *
 * It deliberately does NOT implement the full evaluation-based publish gate described
 * elsewhere in this system's design (golden-set regression scores, Arabic locale-readiness
 * thresholds, grounding-quality gates) — that is wave B-9, and none of its tables
 * (`RegressionRun`, golden-set fixtures, the locale-readiness join) exist yet. Building a
 * richer gate here would mean inventing a shape B-9 would then have to either match by
 * coincidence or replace, so `missingSteps` only ever names `"identity"` and/or
 * `"channels"` — never any of the other eight `WizardStepId`s.
 *
 * Note this deliberately does NOT depend on `WizardDraftRepository`, even though a first
 * reading of "draft validation" suggests it should: completeness is evaluated against the
 * **persisted agent and version** (`agents.getAgentDetail`, `bindings.listChannelBindings`),
 * not against the wizard's own transient `stepStateJson`. A caller always has
 * `agentId`/`agentVersionId` in hand by the time it asks "can this be published", and
 * re-deriving the answer from persisted configuration — rather than from whatever the
 * draft's own step-state blob happens to say — is what keeps this check honest if a step's
 * UI state and its persisted config ever disagree.
 */

import type { WizardStepId } from "../domain/agent.js";
import type { AgentBindingsRepository } from "../ports/agent-bindings-repository.js";
import type { AgentRepository } from "../ports/agent-repository.js";

export interface GetDraftValidationInput {
  readonly agentId: string;
  readonly agentVersionId: string;
}

export interface GetDraftValidationResult {
  readonly complete: boolean;
  readonly missingSteps: readonly WizardStepId[];
}

export interface GetDraftValidationDeps {
  readonly agents: AgentRepository;
  readonly bindings: AgentBindingsRepository;
}

export class GetDraftValidation {
  constructor(private readonly deps: GetDraftValidationDeps) {}

  async execute(input: GetDraftValidationInput): Promise<GetDraftValidationResult> {
    const [agent, channelBindings] = await Promise.all([
      this.deps.agents.getAgentDetail(input.agentId),
      this.deps.bindings.listChannelBindings(input.agentVersionId),
    ]);

    const missingSteps: WizardStepId[] = [];
    // A missing agent counts the same as a missing name: either way "identity" is not
    // satisfied. This never throws — it is asked defensively, ahead of publish, and must
    // answer "not complete" rather than crash the wizard's own validation screen.
    if (!agent || agent.name.trim().length === 0) missingSteps.push("identity");
    if (!channelBindings.some((binding) => binding.isEnabled)) missingSteps.push("channels");

    return { complete: missingSteps.length === 0, missingSteps };
  }
}
