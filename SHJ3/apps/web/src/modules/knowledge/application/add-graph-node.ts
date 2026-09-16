/**
 * "+ Add node" — B6 tab 2 (FR-KNOW-10): a manually authored entity, placed under an
 * optional parent with a relationship, immediately inspectable.
 *
 * SQL-first ordering, per the locked contract's own instruction for endpoint 5: the
 * `GraphNodeRecord` (and, if a parent is given, the `GraphEdgeRecord`) is written as the
 * authoritative record — `origin: 'Authored'` — **before** calling the AI service to apply
 * the same fact onto Neo4j.
 */

import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type { GraphLabel, GraphRelationshipType } from "../domain/knowledge-catalog.js";

export interface AddGraphNodeInput {
  readonly label: GraphLabel;
  readonly canonicalKey: string;
  readonly canonicalName: string;
  /** The parent's own key and label — both are needed because `GraphNodeRecord`'s real uniqueness is `(label, canonicalKey)`, not `canonicalKey` alone. `null` when this node has no parent. */
  readonly parent: { readonly label: GraphLabel; readonly canonicalKey: string } | null;
  readonly relationshipType: GraphRelationshipType | null;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type AddGraphNodeResult =
  | { readonly ok: true; readonly nodeId: string; readonly canonicalKey: string }
  | { readonly ok: false; readonly reason: "knowledge.parent_node_not_found" }
  | { readonly ok: false; readonly reason: string };

export interface AddGraphNodeDeps {
  readonly graph: GraphRepository;
  readonly ai: KnowledgeAiClient;
}

export class AddGraphNode {
  constructor(private readonly deps: AddGraphNodeDeps) {}

  async execute(input: AddGraphNodeInput): Promise<AddGraphNodeResult> {
    let parentId: string | null = null;
    if (input.parent) {
      const parentNode = await this.deps.graph.findNodeByCanonicalKey(
        input.parent.label,
        input.parent.canonicalKey,
      );
      if (!parentNode) return { ok: false, reason: "knowledge.parent_node_not_found" };
      parentId = parentNode.id;
    }

    const node = await this.deps.graph.upsertNode({
      label: input.label,
      canonicalKey: input.canonicalKey,
      canonicalName: input.canonicalName,
      origin: "Authored",
      authoredByStaffUserId: input.actorStaffUserId,
      firstSeenChunkId: null,
      now: input.now,
    });

    if (parentId && input.relationshipType) {
      await this.deps.graph.upsertEdge({
        fromNodeRecordId: parentId,
        toNodeRecordId: node.id,
        relationshipType: input.relationshipType,
        origin: "Authored",
        evidenceChunkId: null,
        confidence: null,
        now: input.now,
      });
    }

    const applied = await this.deps.ai.upsertGraphNode({
      label: input.label,
      canonicalKey: input.canonicalKey,
      canonicalName: input.canonicalName,
      properties: {},
      parentKey: input.parent?.canonicalKey ?? null,
      relationshipType: input.relationshipType,
    });
    if (!applied.ok) return { ok: false, reason: applied.reason };

    return { ok: true, nodeId: node.id, canonicalKey: node.canonicalKey };
  }
}
