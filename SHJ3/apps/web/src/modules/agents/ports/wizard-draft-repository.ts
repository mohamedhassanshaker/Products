/**
 * `AgentWizardDrafts` — the real, server-side persistence `Wizard`'s `onSaveDraft`/
 * `loadDraft` seam expects (`components/patterns/wizard/use-wizard-draft.ts`). One draft
 * row per (owner, agent) — `UQ_AgentWizardDrafts_ownerStaffUserId_agentId` — so two staff
 * users editing the same agent get independent drafts rather than clobbering each other,
 * and hard-deleted on publish (`AgentWizardDraft`'s own doc comment).
 */

export interface WizardDraft {
  readonly id: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly ownerStaffUserId: string;
  /** 1-10, `domain/agent.ts`'s `wizardStepNumber`. */
  readonly lastStep: number;
  /** Raw JSON text — the wizard's own step-state shape is this module's concern (`application/wizard-draft-state.ts`), not the repository's. */
  readonly stepStateJson: string;
  readonly updatedAt: Date;
}

export interface WizardDraftRepository {
  findByOwnerAndAgent(ownerStaffUserId: string, agentId: string): Promise<WizardDraft | null>;

  /** Creates a fresh draft pointed at `agentVersionId`, with empty step state at step 1. */
  create(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly ownerStaffUserId: string;
    readonly now: Date;
  }): Promise<WizardDraft>;

  /** Idempotent full replacement of `lastStep`/`stepStateJson` — matches `docs/api.md`'s "idempotent full replacement of that step's payload" contract for the underlying `PUT`. */
  saveStep(input: {
    readonly draftId: string;
    readonly lastStep: number;
    readonly stepStateJson: string;
    readonly now: Date;
  }): Promise<void>;

  /** Hard delete — called by `publishVersion`'s use case once a draft's version is published. */
  deleteForAgent(agentId: string): Promise<void>;
}
