import type { PipelineRepository } from "../ports/pipeline-repository.js";

export interface DeletePipelineNodeDeps {
  readonly pipelines: PipelineRepository;
}

/** Removes a node from the canvas — a hard delete, cascading to any edge referencing it
 *  (`PipelineRepository.deleteNode`'s own doc comment on the real FK cascade). No
 *  "can't delete the Start node" guard here: `analyzePipelineGraph`'s own
 *  `entry_node_required` finding already surfaces that as a blocking publish-time error,
 *  the same "structural rules live in the analyzer, not scattered across every mutating use
 *  case" division `PublishPipelineVersion` relies on. */
export class DeletePipelineNode {
  constructor(private readonly deps: DeletePipelineNodeDeps) {}

  async execute(id: string, pipelineVersionId: string): Promise<void> {
    await this.deps.pipelines.deleteNode(id, pipelineVersionId);
  }
}
