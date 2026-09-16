import type { PipelineRepository } from "../ports/pipeline-repository.js";

export interface CreatePipelineInput {
  readonly name: string;
  readonly ownerTenantId: string;
  readonly createdByStaffUserId: string;
  readonly now: Date;
}

export type CreatePipelineResult =
  | { readonly ok: true; readonly pipelineDesignId: string; readonly pipelineVersionId: string }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.name_required" };

export interface CreatePipelineDeps {
  readonly pipelines: PipelineRepository;
}

/** "New pipeline" — the create-pipeline dialog's own save action. Mirrors
 *  `modules/agents/application/create-agent.ts`'s identical single-rule shape (a non-blank
 *  name is the only thing worth validating before the repository's own real, FK-cycle-safe
 *  transaction runs — see `PipelineRepository.createPipeline`'s doc comment for what that
 *  transaction actually does: a `Draft` design + its first `v0.1` version + a lone `Start`
 *  node, atomically). */
export class CreatePipeline {
  constructor(private readonly deps: CreatePipelineDeps) {}

  async execute(input: CreatePipelineInput): Promise<CreatePipelineResult> {
    const name = input.name.trim();
    if (name.length === 0) {
      return { ok: false, reason: "orchestration.pipeline.name_required" };
    }
    const { pipelineDesignId, pipelineVersionId } = await this.deps.pipelines.createPipeline({
      ...input,
      name,
    });
    return { ok: true, pipelineDesignId, pipelineVersionId };
  }
}
