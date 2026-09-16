/**
 * `GraphNodeRecords`/`GraphEdgeRecords`/`GraphDuplicateCandidates`/`GraphMergeDecisions` —
 * the authoritative SQL ledger `docs/data-model.md` describes as what keeps Neo4j
 * rebuildable. This port never talks to Neo4j itself (that is `KnowledgeAiClient`'s job) —
 * it is purely the SQL-side decision record.
 */

import type {
  DuplicateDetectionMethod,
  DuplicateState,
  GraphLabel,
  GraphOrigin,
  MergeDecisionKind,
} from "../domain/knowledge-catalog.js";

export interface GraphNodeRecordRow {
  readonly id: string;
  readonly label: GraphLabel;
  readonly canonicalKey: string;
  readonly canonicalName: string;
  readonly origin: GraphOrigin;
  readonly firstSeenChunkId: string | null;
  readonly mergedIntoNodeRecordId: string | null;
  readonly deletedAt: Date | null;
}

export interface UpsertGraphNodeRecordInput {
  readonly label: GraphLabel;
  readonly canonicalKey: string;
  readonly canonicalName: string;
  readonly origin: GraphOrigin;
  readonly authoredByStaffUserId: string | null;
  readonly firstSeenChunkId: string | null;
  readonly now: Date;
}

export interface UpsertGraphEdgeRecordInput {
  readonly fromNodeRecordId: string;
  readonly toNodeRecordId: string;
  readonly relationshipType: string;
  readonly origin: GraphOrigin;
  readonly evidenceChunkId: string | null;
  readonly confidence: number | null;
  readonly now: Date;
}

export interface GraphDuplicateCandidateRow {
  readonly id: string;
  readonly leftNodeRecordId: string;
  readonly rightNodeRecordId: string;
  readonly leftName: string;
  readonly rightName: string;
  readonly similarity: number;
  readonly detectionMethod: DuplicateDetectionMethod;
  readonly state: DuplicateState;
  readonly detectedAt: Date;
}

export interface GraphRepository {
  /** Matched by `(label, canonicalKey)` — the real `UQ_GraphNodeRecords_label_canonicalKey` composite (WHERE `deletedAt IS NULL`). Inserts on first sight, otherwise leaves the existing row's identity alone and only refreshes `canonicalName`. */
  upsertNode(input: UpsertGraphNodeRecordInput): Promise<GraphNodeRecordRow>;
  findNodeByCanonicalKey(
    label: GraphLabel,
    canonicalKey: string,
  ): Promise<GraphNodeRecordRow | null>;
  getNode(id: string): Promise<GraphNodeRecordRow | null>;
  /** Nodes first sighted in any of `chunkIds` — `RemoveSource`'s best-effort approximation of FR-KNOW-04's "entities supported by no other source" (see that use case's own doc comment for the honest scope note). */
  listNodesFirstSeenIn(chunkIds: readonly string[]): Promise<readonly GraphNodeRecordRow[]>;
  /** Matched by the real `UQ_GraphEdgeRecords_triple (fromNodeRecordId, toNodeRecordId, relationshipType)`. */
  upsertEdge(input: UpsertGraphEdgeRecordInput): Promise<void>;
  softDeleteNode(id: string, now: Date): Promise<void>;

  listOpenDuplicateCandidates(): Promise<readonly GraphDuplicateCandidateRow[]>;
  /** Idempotent by the ordered-pair identity the real schema computes; the fake/Prisma adapter matches on `(leftNodeRecordId, rightNodeRecordId)` order-insensitively. */
  upsertDuplicateCandidate(input: {
    readonly leftNodeRecordId: string;
    readonly rightNodeRecordId: string;
    readonly similarity: number;
    readonly detectionMethod: DuplicateDetectionMethod;
    readonly now: Date;
  }): Promise<GraphDuplicateCandidateRow>;
  setDuplicateCandidateState(id: string, state: DuplicateState, now: Date): Promise<void>;
  getDuplicateCandidate(id: string): Promise<GraphDuplicateCandidateRow | null>;

  recordMergeDecision(input: {
    readonly graphDuplicateCandidateId: string;
    readonly decision: MergeDecisionKind;
    readonly survivingNodeRecordId: string | null;
    readonly absorbedNodeRecordId: string | null;
    readonly decidedByStaffUserId: string;
    readonly now: Date;
  }): Promise<void>;
}
