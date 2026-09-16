import type { PipelineRepository } from "../ports/pipeline-repository.js";

export interface DeletePipelineEdgeDeps {
  readonly pipelines: PipelineRepository;
}

export class DeletePipelineEdge {
  constructor(private readonly deps: DeletePipelineEdgeDeps) {}

  async execute(id: string, pipelineVersionId: string): Promise<void> {
    await this.deps.pipelines.deleteEdge(id, pipelineVersionId);
  }
}
