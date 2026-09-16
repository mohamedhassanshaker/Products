/**
 * Publish an agent version — B2's registry **Publish** action, and B3 step 10's own Publish
 * button, applied to whichever `AgentVersion` the wizard draft currently points at.
 *
 * ## Why this checks `canPublish` before calling the repository
 *
 * `AgentRepository.publishVersion` already re-checks `version.status !== 'Published'`
 * itself and returns the identical `{ok:false, reason:"agent.already_published"}` shape —
 * this use case's own check is defense in depth, not a substitute for it. The reason to
 * still check here first is `domain/agent-lifecycle.ts`'s own `canPublish` doc comment: a
 * use case should not call a repository method it already knows will be rejected, even
 * though the repository's own guard would catch the same thing anyway. In practice this
 * should never actually fire — `get-or-create-wizard-draft.ts` never hands back an
 * already-Published version to edit — so a rejection here means that invariant broke
 * somewhere upstream, not routine user error.
 *
 * ## Why the draft is deleted only on success
 *
 * `WizardDraftRepository.deleteForAgent` is called **after**, and only after,
 * `publishVersion` reports `ok: true` — `AgentWizardDrafts` are hard-deleted on publish
 * (that port's own doc comment), and deleting the draft for a publish that did not actually
 * happen would strand the wizard with no way back to what the user was editing.
 *
 * ## The evaluation publish gate (FR-AGENT-20, B-9)
 *
 * `deps.gate` is OPTIONAL and injected — every existing caller/test that does not supply
 * one keeps working unchanged (this constructor predates the gate; B-9 added it as a later
 * wave, exactly as this file's own earlier doc comment on `GetDraftValidation` already
 * flagged). When supplied, it is checked BEFORE `agents.publishVersion(...)` is ever
 * called: `gate.evaluateForPublish(...)` both decides AND persists the `GateEvaluation`
 * row itself (`evaluation/application/evaluate-gate-for-version.ts`'s own job — this
 * module never writes that table directly), so the decision is auditable whichever way it
 * goes, and a blocked publish never reaches `AgentRepository.publishVersion` at all — the
 * gate is enforced at the application layer (there is no DB trigger for this transition,
 * unlike the promotion path's `TR_PromotionRequests_decisionRules`).
 */

import { canPublish } from "../domain/agent-lifecycle.js";
import type { AgentRepository } from "../ports/agent-repository.js";
import type {
  PublishGateBlockingReason,
  PublishGateChecker,
} from "../ports/publish-gate-checker.js";
import type { WizardDraftRepository } from "../ports/wizard-draft-repository.js";

export interface PublishAgentVersionInput {
  readonly agentVersionId: string;
  readonly agentId: string;
  readonly changeSummary: string | null;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type PublishAgentVersionResult =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: "agent.already_published" }
  | {
      readonly ok: false;
      readonly reason: "gate_blocked";
      /** FR-EVAL-08: "names the agent, version, failing set, its score, and the missed
       *  threshold" — everything the UI needs to render that sentence without a second
       *  round trip. */
      readonly agentName: string;
      readonly versionLabel: string;
      readonly reasons: readonly PublishGateBlockingReason[];
    };

export interface PublishAgentVersionDeps {
  readonly agents: AgentRepository;
  readonly drafts: WizardDraftRepository;
  readonly gate?: PublishGateChecker;
}

export class PublishAgentVersion {
  constructor(private readonly deps: PublishAgentVersionDeps) {}

  async execute(input: PublishAgentVersionInput): Promise<PublishAgentVersionResult> {
    const { agents, drafts, gate } = this.deps;

    const version = await agents.getVersion(input.agentVersionId);
    if (!version) {
      throw new Error(
        `Cannot publish agent version "${input.agentVersionId}": no such version. ` +
          "Publishing acts on a version the wizard already loaded, never an arbitrary id.",
      );
    }

    const check = canPublish(version.status);
    if (!check.allowed) {
      return { ok: false, reason: check.reason };
    }

    if (gate) {
      const decision = await gate.evaluateForPublish({
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        now: input.now,
      });
      if (!decision.passed) {
        const agentDetail = await agents.getAgentDetail(input.agentId);
        return {
          ok: false,
          reason: "gate_blocked",
          agentName: agentDetail?.name ?? input.agentId,
          versionLabel: version.label,
          reasons: decision.reasons,
        };
      }
    }

    const result = await agents.publishVersion({
      agentVersionId: input.agentVersionId,
      changeSummary: input.changeSummary,
      actorStaffUserId: input.actorStaffUserId,
      now: input.now,
    });

    if (result.ok) {
      await drafts.deleteForAgent(input.agentId);
    }

    return result;
  }
}
