import type { PublishedAgentPort } from "../ports/published-agent-port.js";
import type { PipelineNodeRow, PipelineRepository, UpdatePipelineNodeInput } from "../ports/pipeline-repository.js";
import type { CreatePipelineNodeReason } from "./create-pipeline-node.js";

export type UpdatePipelineNodeResult =
  | { readonly ok: true; readonly node: PipelineNodeRow }
  | { readonly ok: false; readonly reason: CreatePipelineNodeReason };

export interface UpdatePipelineNodeDeps {
  readonly pipelines: PipelineRepository;
  readonly agents: PublishedAgentPort;
}

/** Edits a node's inspector fields — the same "a plain `agentId` must be Published" check
 *  `CreatePipelineNode` runs, applied here only when the edit actually touches `agentId`
 *  (an edit that never changes it, e.g. just moving the node, never needs the registry
 *  round trip). */
export class UpdatePipelineNode {
  constructor(private readonly deps: UpdatePipelineNodeDeps) {}

  async execute(input: UpdatePipelineNodeInput): Promise<UpdatePipelineNodeResult> {
    if (input.agentId !== undefined && input.agentId !== null) {
      const published = await this.deps.agents.listPublished();
      if (!published.some((agent) => agent.id === input.agentId)) {
        return { ok: false, reason: "orchestration.pipeline.agent_not_published" };
      }
    }
    const node = await this.deps.pipelines.updateNode(input);
    return { ok: true, node };
  }
}
