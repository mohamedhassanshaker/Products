/**
 * Open a flow for authoring — the flows-module twin of `modules/agents/application/
 * get-or-create-wizard-draft.ts`'s `forkOrReuseDraftVersion` half (see that file's own doc
 * comment for the full "why fork, not reuse `currentVersionId` blindly" derivation; the same
 * reasoning applies here unchanged).
 *
 * `existingFlowId` is supplied by the caller (the wizard's `flows` Server Action), resolved
 * from `AgentFlowBinding` via `modules/agents`' own port — this module has no knowledge of
 * agents at all (module-boundary rule, see `flow-repository.ts`'s doc comment). `null` means
 * "this agent has no bound flow yet," in which case a brand-new one is created.
 *
 * ## `existingFlowVersionId` — the missing "am I already editing a draft" check
 *
 * `Flow.currentVersionId` deliberately never moves to a forked Draft until that draft is
 * itself published (`PrismaFlowRepository.forkOrReuseDraftVersion`'s own doc comment — the
 * same "never silently change what's live" reasoning `PrismaAgentRepository`'s identical
 * method states for `AgentVersion`). For agents, that gap is closed by a real, persisted
 * `WizardDraft` row (`get-or-create-wizard-draft.ts`) that remembers which forked Draft an
 * owner is already editing, checked BEFORE ever calling `forkOrReuseDraftVersion` again. This
 * module has no such table of its own — but it does not need one: `AgentFlowBinding.
 * flowVersionId`, once bound, already points at exactly the version being authored, and the
 * caller (`loadFlowsStepDataAction`) already has it in hand as `primary.flowVersionId`. A
 * real, live-reproduced bug (found by a Playwright verification pass, not a review) confirmed
 * what skipping this check actually does: every single page load re-forked a brand-new, empty
 * Draft off the Published version — `Flow.currentVersionId` never resolved to the prior
 * Draft, `forkOrReuseDraftVersion`'s own `current.status !== "Published"` reuse branch never
 * fired, and the flow's real nodes/edges appeared to vanish on every reload. Checking whether
 * `existingFlowVersionId` is itself already non-Published (still open for editing) BEFORE
 * calling `forkOrReuseDraftVersion` closes the gap with no schema change, mirroring the
 * agents module's own "check existing state first, only fork when truly necessary" discipline
 * using a pointer this module already had.
 */

import type { FlowRepository } from "../ports/flow-repository.js";

export interface GetOrCreateDraftFlowVersionInput {
  readonly existingFlowId: string | null;
  /** The flow version this caller was already bound to editing, if any — see this file's own module doc comment ("`existingFlowVersionId`") for why this must be checked before ever forking a new Draft. Ignored when `existingFlowId` is null. */
  readonly existingFlowVersionId?: string | null;
  /** Used only when `existingFlowId` is null — the name for a brand-new flow. */
  readonly newFlowName: string;
  readonly ownerTenantId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export interface GetOrCreateDraftFlowVersionDeps {
  readonly flows: FlowRepository;
}

export class GetOrCreateDraftFlowVersion {
  constructor(private readonly deps: GetOrCreateDraftFlowVersionDeps) {}

  async execute(
    input: GetOrCreateDraftFlowVersionInput,
  ): Promise<{ readonly flowId: string; readonly flowVersionId: string }> {
    if (input.existingFlowId) {
      if (input.existingFlowVersionId) {
        const boundVersion = await this.deps.flows.getFlowVersion(input.existingFlowVersionId);
        // Already a Draft (or an Archived version left bound by some other path) — reuse it
        // directly, exactly like `forkOrReuseDraftVersion`'s own reuse branch would, but keyed
        // off the version this caller actually knows it is editing rather than
        // `Flow.currentVersionId`, which never reflects a forked-but-unpublished Draft.
        if (boundVersion && boundVersion.status !== "Published") {
          return { flowId: input.existingFlowId, flowVersionId: boundVersion.id };
        }
      }

      const { flowVersionId } = await this.deps.flows.forkOrReuseDraftVersion({
        flowId: input.existingFlowId,
        actorStaffUserId: input.actorStaffUserId,
        now: input.now,
      });
      return { flowId: input.existingFlowId, flowVersionId };
    }

    return this.deps.flows.createFlow({
      name: input.newFlowName,
      ownerTenantId: input.ownerTenantId,
      createdByStaffUserId: input.actorStaffUserId,
      now: input.now,
    });
  }
}
