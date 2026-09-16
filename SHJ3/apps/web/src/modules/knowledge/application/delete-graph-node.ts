/** Deletes a manually authored (or extracted) graph node — soft-deletes the authoritative SQL record, then applies the deletion to Neo4j. */

import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";

export interface DeleteGraphNodeInput {
  readonly nodeId: string;
  readonly now: Date;
}

export type DeleteGraphNodeResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "knowledge.node_not_found" };

export interface DeleteGraphNodeDeps {
  readonly graph: GraphRepository;
  readonly ai: KnowledgeAiClient;
}

export class DeleteGraphNode {
  constructor(private readonly deps: DeleteGraphNodeDeps) {}

  async execute(input: DeleteGraphNodeInput): Promise<DeleteGraphNodeResult> {
    const node = await this.deps.graph.getNode(input.nodeId);
    if (!node) return { ok: false, reason: "knowledge.node_not_found" };

    await this.deps.graph.softDeleteNode(node.id, input.now);
    await this.deps.ai.deleteGraphNode(node.canonicalKey);
    return { ok: true };
  }
}
