import type { PipelineRepository } from "../ports/pipeline-repository.js";

export interface GetOrCreateDraftPipelineVersionDeps {
  readonly pipelines: PipelineRepository;
}

/** Opening the pipeline editor on a design — reuses its already-Draft version, or forks a
 *  new Draft off the current Published one, exactly `PipelineRepository.
 *  forkOrReuseDraftVersion`'s own contract (see that method's doc comment for the FK-cycle-
 *  safe deep copy this performs). Mirrors `modules/flows/application/get-or-create-draft-
 *  flow-version.ts`'s identical one-line delegation — the real logic belongs to the
 *  repository, not a business rule this use case adds on top. */
export class GetOrCreateDraftPipelineVersion {
  constructor(private readonly deps: GetOrCreateDraftPipelineVersionDeps) {}

  async execute(input: {
    readonly pipelineDesignId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineVersionId: string }> {
    return this.deps.pipelines.forkOrReuseDraftVersion(input);
  }
}
