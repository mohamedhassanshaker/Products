import type { PublishedAgentPort } from "../ports/published-agent-port.js";
import type { NewPipelineNodeInput, PipelineNodeRow, PipelineRepository } from "../ports/pipeline-repository.js";

export type CreatePipelineNodeInput = Omit<NewPipelineNodeInput, "now">;

export type CreatePipelineNodeReason =
  | "orchestration.pipeline.agent_required"
  | "orchestration.pipeline.agent_and_turn_bound_are_exclusive"
  | "orchestration.pipeline.agent_not_published";

export type CreatePipelineNodeResult =
  | { readonly ok: true; readonly node: PipelineNodeRow }
  | { readonly ok: false; readonly reason: CreatePipelineNodeReason };

export interface CreatePipelineNodeDeps {
  readonly pipelines: PipelineRepository;
  readonly agents: PublishedAgentPort;
}

/** Drops a new node on the canvas — mirrors `CreateFlowNode`'s "check the one real-world
 *  reference before the repository's own INSERT" shape (rule 7's own precedent from
 *  `UpdateRouterConfig`). `CK_PipelineNodes_agentPaired`/`_pinNeedsAgent` (SQL) enforce the
 *  structural pairing; the one thing worth checking HERE, before that constraint is even
 *  reached, is that a plain `agentId` (not `agentVersionPinId`, and not `usesTurnBoundAgent`)
 *  actually names a currently-Published agent — the same "a human is building a real graph,
 *  don't silently accept a dangling reference" reasoning `UpdateRouterConfig`'s own rule 7
 *  already established for this exact port. */
export class CreatePipelineNode {
  constructor(private readonly deps: CreatePipelineNodeDeps) {}

  async execute(
    input: CreatePipelineNodeInput & { readonly now: Date },
  ): Promise<CreatePipelineNodeResult> {
    if (input.kind === "Agent" || input.kind === "Supervisor") {
      if (!input.usesTurnBoundAgent && input.agentId === null && input.agentVersionPinId === null) {
        return { ok: false, reason: "orchestration.pipeline.agent_required" };
      }
      if (input.usesTurnBoundAgent && (input.agentId !== null || input.agentVersionPinId !== null)) {
        return { ok: false, reason: "orchestration.pipeline.agent_and_turn_bound_are_exclusive" };
      }
      if (input.agentId !== null) {
        const published = await this.deps.agents.listPublished();
        if (!published.some((agent) => agent.id === input.agentId)) {
          return { ok: false, reason: "orchestration.pipeline.agent_not_published" };
        }
      }
    }

    const node = await this.deps.pipelines.createNode(input);
    return { ok: true, node };
  }
}
