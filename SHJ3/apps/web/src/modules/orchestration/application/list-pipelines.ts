import type { PipelineDesignRow, PipelineRepository } from "../ports/pipeline-repository.js";

export interface ListPipelinesDeps {
  readonly pipelines: PipelineRepository;
}

/** The Pipeline Designer's own landing list — every non-deleted `PipelineDesign`, newest
 *  edit first (`PrismaPipelineRepository.listDesigns`'s own ordering). Mirrors
 *  `modules/agents/application/list-agents.ts`'s "one thin read, no business rule of its
 *  own" shape. */
export class ListPipelines {
  constructor(private readonly deps: ListPipelinesDeps) {}

  async execute(): Promise<readonly PipelineDesignRow[]> {
    return this.deps.pipelines.listDesigns();
  }
}
