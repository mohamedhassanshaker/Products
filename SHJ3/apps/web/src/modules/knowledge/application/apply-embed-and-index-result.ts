/**
 * Applies one `POST /knowledge/ingest/embed-and-index` response onto the SQL system of
 * record — the second half of §9.2 step 6, and the exact mechanism the contract brief
 * names: "update each `Chunk.vectorState`/`graphState`/... and upsert `GraphNodeRecord`/
 * `GraphEdgeRecord` rows ... for every entry in `graphWrites`/`edgeWrites`". Shared by
 * `process-knowledge-outbox.ts` and `run-reindex-job.ts` — both call the same AI endpoint
 * and must apply its response identically, so the apply step lives in exactly one place.
 */

import { isGraphLabel } from "../domain/knowledge-catalog.js";
import type { ChunkRepository } from "../ports/chunk-repository.js";
import type { GraphRepository } from "../ports/graph-repository.js";
import type { EmbedAndIndexResult } from "../ports/knowledge-ai-client.js";

export interface ApplyEmbedAndIndexResultDeps {
  readonly chunks: ChunkRepository;
  readonly graph: GraphRepository;
}

export interface ApplyEmbedAndIndexResultInput {
  readonly response: EmbedAndIndexResult;
  readonly embeddingModel: string;
  readonly embeddingDimension: number;
  readonly now: Date;
}

export async function applyEmbedAndIndexResult(
  deps: ApplyEmbedAndIndexResultDeps,
  input: ApplyEmbedAndIndexResultInput,
): Promise<void> {
  const { response, embeddingModel, embeddingDimension, now } = input;

  for (const result of response.results) {
    await deps.chunks.applyEmbedResult({
      chunkId: result.chunkId,
      vectorState: result.vectorState,
      graphState: result.graphState,
      embeddingModel,
      embeddingDimension,
      now,
    });
  }

  // Node writes are applied first so the edge loop below can resolve fromKey/toKey against
  // nodes this same response just (re)confirmed — see this function's own limitation note
  // below for the one case that does not resolve.
  const keyToNodeId = new Map<string, string>();
  for (const nodeWrite of response.graphWrites) {
    if (!isGraphLabel(nodeWrite.label)) {
      console.warn(
        `[apply-embed-and-index-result] skipping a graphWrite with an unrecognized label "${nodeWrite.label}" for canonicalKey "${nodeWrite.canonicalKey}".`,
      );
      continue;
    }
    const node = await deps.graph.upsertNode({
      label: nodeWrite.label,
      canonicalKey: nodeWrite.canonicalKey,
      canonicalName: nodeWrite.canonicalName,
      origin: "Extracted",
      authoredByStaffUserId: null,
      firstSeenChunkId: nodeWrite.firstSeenChunkId,
      now,
    });
    keyToNodeId.set(nodeWrite.canonicalKey, node.id);
  }

  // A known, honest limitation: an edge whose endpoint was NOT part of this same response's
  // `graphWrites` (an edge into a pre-existing entity from an earlier ingest) cannot be
  // resolved from this map alone. `GraphRepository.findNodeByCanonicalKey` needs a label,
  // which `edgeWrites` does not carry — so such an edge is skipped with a logged warning
  // rather than guessed at across all five labels. In practice this only affects edges
  // reaching outside the batch just embedded, which re-indexing the source again repairs.
  for (const edgeWrite of response.edgeWrites) {
    const fromId = keyToNodeId.get(edgeWrite.fromKey);
    const toId = keyToNodeId.get(edgeWrite.toKey);
    if (!fromId || !toId) {
      console.warn(
        `[apply-embed-and-index-result] skipping edge "${edgeWrite.relationshipType}" (${edgeWrite.fromKey} -> ${edgeWrite.toKey}): an endpoint was not part of this response's own graphWrites.`,
      );
      continue;
    }
    await deps.graph.upsertEdge({
      fromNodeRecordId: fromId,
      toNodeRecordId: toId,
      relationshipType: edgeWrite.relationshipType,
      origin: "Extracted",
      evidenceChunkId: edgeWrite.evidenceChunkId,
      confidence: edgeWrite.confidence,
      now,
    });
  }
}
