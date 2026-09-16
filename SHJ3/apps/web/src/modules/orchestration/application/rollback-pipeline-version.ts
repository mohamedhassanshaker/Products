import type { PipelineRepository } from "../ports/pipeline-repository.js";

export type RollbackPipelineVersionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.version_is_current" };

export interface RollbackPipelineVersionDeps {
  readonly pipelines: PipelineRepository;
}

/** Rolls a design back to a previously-Published version — a thin delegation to
 *  `PipelineRepository.rollbackToVersion`, mirroring `RollbackAgentVersion`'s identical
 *  shape (the real logic — which version is `isCurrent`, the `RolledBack` history entry —
 *  belongs to the repository, per that method's own doc comment). Rolling back does NOT
 *  touch `RouterConfigs.activePipelineVersionId` on its own: an already-`Activated` version
 *  keeps running turns until an admin explicitly re-activates the rolled-back-to version via
 *  `SetActivePipelineVersion` — the same "two separate, both-audited acts" split this
 *  module's design settled on. */
export class RollbackPipelineVersion {
  constructor(private readonly deps: RollbackPipelineVersionDeps) {}

  async execute(input: {
    readonly pipelineDesignId: string;
    readonly targetVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<RollbackPipelineVersionResult> {
    return this.deps.pipelines.rollbackToVersion(input);
  }
}
