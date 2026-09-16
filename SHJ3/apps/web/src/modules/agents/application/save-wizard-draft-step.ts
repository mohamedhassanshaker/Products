/**
 * Save one wizard step — the real seam the `Wizard` organism's `onSaveDraft(stepId)`
 * callback calls through, via a future Server Action.
 *
 * A clean, direct, idempotent full-replace: `WizardDraftRepository.saveStep`'s own doc
 * comment already promises "idempotent full replacement of `lastStep`/`stepStateJson`"
 * (matching `docs/api.md`'s PUT contract), so this use case adds nothing on top of it — a
 * thicker wrapper here would only be a second place that could disagree with the port about
 * what "save a step" means.
 */

import type { WizardDraftRepository } from "../ports/wizard-draft-repository.js";

export interface SaveWizardDraftStepInput {
  readonly draftId: string;
  readonly lastStep: number;
  readonly stepStateJson: string;
  readonly now: Date;
}

export interface SaveWizardDraftStepDeps {
  readonly drafts: WizardDraftRepository;
}

export class SaveWizardDraftStep {
  constructor(private readonly deps: SaveWizardDraftStepDeps) {}

  async execute(input: SaveWizardDraftStepInput): Promise<void> {
    await this.deps.drafts.saveStep(input);
  }
}
