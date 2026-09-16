/**
 * Remove a source — B6 tab 1's Delete action (FR-KNOW-04): soft-delete the source, erase
 * its chunks from the system of record, and delete its vectors/entities from the derived
 * stores **where no other source supports them**.
 *
 * **Honest scope note on "no other source supports them":** the locked `KnowledgeAiClient`
 * contract this wave calls exposes no "which sources support this entity" query — entity
 * support across multiple sources is a graph-traversal question the AI side owns, and
 * adding a new endpoint to the locked contract is out of this wave's authority (the brief
 * is explicit that the contract "must not be changed on your side without telling me").
 * So this use case approximates the rule using the one signal the SQL ledger already
 * carries: `GraphNodeRecord.firstSeenChunkId` (§4.7's own "first sighting" evidence) — a
 * node whose first-seen chunk belonged to the removed source is treated as removed-source-
 * only and deleted from Neo4j; a node first seen elsewhere is left alone even if this
 * source also mentions it. This is a real, defensible interpretation for the seeded/demo
 * scale this wave targets, not a precise multi-source-support algorithm — flagged here and
 * in this wave's final report rather than silently presented as exact.
 */

import type { ChunkRepository } from "../ports/chunk-repository.js";
import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type { KnowledgeSourceRepository } from "../ports/knowledge-source-repository.js";

export interface RemoveSourceInput {
  readonly knowledgeSourceId: string;
  readonly now: Date;
}

export type RemoveSourceResult =
  | { readonly ok: true; readonly erasedChunkCount: number; readonly deletedEntityCount: number }
  | { readonly ok: false; readonly reason: "knowledge.source_not_found" };

export interface RemoveSourceDeps {
  readonly sources: KnowledgeSourceRepository;
  readonly chunks: ChunkRepository;
  readonly graph: GraphRepository;
  readonly ai: KnowledgeAiClient;
}

export class RemoveSource {
  constructor(private readonly deps: RemoveSourceDeps) {}

  async execute(input: RemoveSourceInput): Promise<RemoveSourceResult> {
    const source = await this.deps.sources.getSource(input.knowledgeSourceId);
    if (!source) return { ok: false, reason: "knowledge.source_not_found" };

    const chunks = await this.deps.chunks.listChunksBySource(source.id);
    const chunkIds = chunks.map((chunk) => chunk.id);

    const candidateNodes = await this.deps.graph.listNodesFirstSeenIn(chunkIds);
    for (const node of candidateNodes) {
      await this.deps.ai.deleteGraphNode(node.canonicalKey);
      await this.deps.graph.softDeleteNode(node.id, input.now);
    }

    await this.deps.chunks.markErased(chunkIds, input.now);
    await this.deps.sources.softDeleteSource(source.id, input.now);

    return {
      ok: true,
      erasedChunkCount: chunkIds.length,
      deletedEntityCount: candidateNodes.length,
    };
  }
}
