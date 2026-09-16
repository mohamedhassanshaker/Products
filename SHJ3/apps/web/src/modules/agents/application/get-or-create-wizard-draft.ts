/**
 * Open the wizard for an agent — the seam behind B3's wizard entry point (both "Edit" on an
 * existing agent and the wizard immediately after **+ New agent** / **Clone**).
 *
 * The most important orchestration in this module, because it is the one place three
 * separate facts have to agree: whether a draft already exists for this (owner, agent) pair,
 * whether the agent's current version is itself still editable, and which version a
 * newly-created draft should actually point at.
 *
 * ## Why an existing draft is returned as-is, with no other port called
 *
 * `WizardDraftRepository.findByOwnerAndAgent` already carries everything the wizard needs
 * (`agentVersionId`, `lastStep`, `stepStateJson`). Calling `forkOrReuseDraftVersion` again on
 * top of an existing draft would either be a silent no-op (the version is already a Draft) or
 * — worse — fork a *second* new Draft version nobody asked for, orphaning the first. So this
 * path returns the found `WizardDraft` directly and never touches `AgentRepository` at all.
 *
 * ## Why a new draft always goes through `forkOrReuseDraftVersion` first
 *
 * A wizard can only ever edit a Draft `AgentVersion` — `TR_AgentVersions_publishedImmutable`
 * forbids writing to a Published one directly. `forkOrReuseDraftVersion` is what makes that
 * true regardless of the agent's current state: it returns the existing current version
 * unchanged when that version is already a Draft (a brand-new agent, or one already mid-edit
 * with no separate draft row yet — e.g. its previous draft was deleted without publishing),
 * and forks a brand-new Draft version off the current one when that version is Published (an
 * agent being reopened for a new round of edits). Either way, the id this returns is the one
 * the new `WizardDraft` is created against — never the agent's `currentVersionId` blindly,
 * which would hand a Published version to the wizard on the fork path.
 *
 * ## Return shape
 *
 * Returns the `WizardDraft` itself (its `id` field *is* the draft id) rather than a
 * `{draftId, ...}`-renamed wrapper — the found-draft path and the newly-created-draft path
 * both return exactly what `WizardDraftRepository` returns, so there is only one shape to
 * document and no risk of the two paths drifting apart.
 */

import type { AgentRepository } from "../ports/agent-repository.js";
import type { WizardDraft, WizardDraftRepository } from "../ports/wizard-draft-repository.js";

export interface GetOrCreateWizardDraftInput {
  readonly agentId: string;
  readonly ownerStaffUserId: string;
  readonly now: Date;
}

export interface GetOrCreateWizardDraftDeps {
  readonly agents: AgentRepository;
  readonly drafts: WizardDraftRepository;
}

export class GetOrCreateWizardDraft {
  constructor(private readonly deps: GetOrCreateWizardDraftDeps) {}

  async execute(input: GetOrCreateWizardDraftInput): Promise<WizardDraft> {
    const { agents, drafts } = this.deps;

    const existing = await drafts.findByOwnerAndAgent(input.ownerStaffUserId, input.agentId);
    if (existing) return existing;

    const { agentVersionId } = await agents.forkOrReuseDraftVersion({
      agentId: input.agentId,
      actorStaffUserId: input.ownerStaffUserId,
      now: input.now,
    });

    return drafts.create({
      agentId: input.agentId,
      agentVersionId,
      ownerStaffUserId: input.ownerStaffUserId,
      now: input.now,
    });
  }
}
