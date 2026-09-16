import type { PipelineRepository } from "../ports/pipeline-repository.js";

export interface SetPipelineEntryNodeDeps {
  readonly pipelines: PipelineRepository;
}

/** Designates a version's entry node — legal on any node today (the canvas UI only ever
 *  offers this for the version's own `Start` node in practice, but nothing here enforces
 *  that as a hard rule; `analyzePipelineGraph`'s `entry_node_required`/
 *  `multiple_entry_nodes` findings are computed from `kind === "Start"`, independent of
 *  this pointer, so a mis-set entry surfaces as a real blocking finding rather than
 *  silently mis-executing). */
export class SetPipelineEntryNode {
  constructor(private readonly deps: SetPipelineEntryNodeDeps) {}

  async execute(pipelineVersionId: string, nodeId: string, now: Date): Promise<void> {
    await this.deps.pipelines.setEntryNode(pipelineVersionId, nodeId, now);
  }
}
