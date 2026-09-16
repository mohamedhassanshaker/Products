/** The real `GraphRepository` — `GraphNodeRecords`/`GraphEdgeRecords`/`GraphDuplicateCandidates`/`GraphMergeDecisions`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isDuplicateDetectionMethod,
  isDuplicateState,
  isGraphLabel,
  isGraphOrigin,
} from "../../../domain/knowledge-catalog.js";
import type {
  GraphDuplicateCandidateRow,
  GraphNodeRecordRow,
  GraphRepository,
  UpsertGraphEdgeRecordInput,
  UpsertGraphNodeRecordInput,
} from "../../../ports/graph-repository.js";

const OPERATION = "knowledge graph repository";

function toNodeRow(row: {
  id: string;
  label: string;
  canonicalKey: string;
  canonicalName: string;
  origin: string;
  firstSeenChunkId: string | null;
  mergedIntoNodeRecordId: string | null;
  deletedAt: Date | null;
}): GraphNodeRecordRow {
  if (!isGraphLabel(row.label) || !isGraphOrigin(row.origin)) {
    throw new Error(`GraphNodeRecord ${row.id} has an unrecognized label/origin.`);
  }
  return {
    id: row.id,
    label: row.label,
    canonicalKey: row.canonicalKey,
    canonicalName: row.canonicalName,
    origin: row.origin,
    firstSeenChunkId: row.firstSeenChunkId,
    mergedIntoNodeRecordId: row.mergedIntoNodeRecordId,
    deletedAt: row.deletedAt,
  };
}

function toDuplicateRow(row: {
  id: string;
  leftNodeRecordId: string;
  rightNodeRecordId: string;
  leftNode: { canonicalName: string };
  rightNode: { canonicalName: string };
  similarity: unknown;
  detectionMethod: string;
  state: string;
  detectedAt: Date;
}): GraphDuplicateCandidateRow {
  if (!isDuplicateDetectionMethod(row.detectionMethod) || !isDuplicateState(row.state)) {
    throw new Error(`GraphDuplicateCandidate ${row.id} has an unrecognized detectionMethod/state.`);
  }
  return {
    id: row.id,
    leftNodeRecordId: row.leftNodeRecordId,
    rightNodeRecordId: row.rightNodeRecordId,
    leftName: row.leftNode.canonicalName,
    rightName: row.rightNode.canonicalName,
    similarity: Number(row.similarity),
    detectionMethod: row.detectionMethod,
    state: row.state,
    detectedAt: row.detectedAt,
  };
}

export class PrismaGraphRepository implements GraphRepository {
  async upsertNode(input: UpsertGraphNodeRecordInput): Promise<GraphNodeRecordRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.graphNodeRecord.findFirst({
      where: { label: input.label, canonicalKey: input.canonicalKey, deletedAt: null },
    });
    if (existing) {
      const updated = await db.graphNodeRecord.update({
        where: { id: existing.id },
        data: { canonicalName: input.canonicalName, updatedAt: input.now },
      });
      return toNodeRow(updated);
    }
    const created = await db.graphNodeRecord.create({
      data: {
        id: newUlid(input.now),
        label: input.label,
        canonicalKey: input.canonicalKey,
        canonicalName: input.canonicalName,
        aliasesJson: null,
        propertiesJson: null,
        origin: input.origin,
        authoredByStaffUserId: input.authoredByStaffUserId,
        firstSeenChunkId: input.firstSeenChunkId,
        mergedIntoNodeRecordId: null,
        mergedAt: null,
        deletedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toNodeRow(created);
  }

  async findNodeByCanonicalKey(
    label: string,
    canonicalKey: string,
  ): Promise<GraphNodeRecordRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.graphNodeRecord.findFirst({
      where: { label, canonicalKey, deletedAt: null },
    });
    return row ? toNodeRow(row) : null;
  }

  async getNode(id: string): Promise<GraphNodeRecordRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.graphNodeRecord.findFirst({ where: { id, deletedAt: null } });
    return row ? toNodeRow(row) : null;
  }

  async listNodesFirstSeenIn(chunkIds: readonly string[]): Promise<readonly GraphNodeRecordRow[]> {
    if (chunkIds.length === 0) return [];
    const db = getTenantDb(OPERATION);
    const rows = await db.graphNodeRecord.findMany({
      where: { firstSeenChunkId: { in: [...chunkIds] }, deletedAt: null },
    });
    return rows.map(toNodeRow);
  }

  async upsertEdge(input: UpsertGraphEdgeRecordInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    const existing = await db.graphEdgeRecord.findFirst({
      where: {
        fromNodeRecordId: input.fromNodeRecordId,
        toNodeRecordId: input.toNodeRecordId,
        relationshipType: input.relationshipType,
        deletedAt: null,
      },
    });
    if (existing) {
      await db.graphEdgeRecord.update({
        where: { id: existing.id },
        data: {
          evidenceChunkId: input.evidenceChunkId,
          confidence: input.confidence,
          updatedAt: input.now,
        },
      });
      return;
    }
    await db.graphEdgeRecord.create({
      data: {
        id: newUlid(input.now),
        fromNodeRecordId: input.fromNodeRecordId,
        toNodeRecordId: input.toNodeRecordId,
        relationshipType: input.relationshipType,
        propertiesJson: null,
        origin: input.origin,
        evidenceChunkId: input.evidenceChunkId,
        confidence: input.confidence,
        deletedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  }

  async softDeleteNode(id: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.graphNodeRecord.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
  }

  async listOpenDuplicateCandidates(): Promise<readonly GraphDuplicateCandidateRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.graphDuplicateCandidate.findMany({
      where: { state: "Open" },
      include: {
        leftNode: { select: { canonicalName: true } },
        rightNode: { select: { canonicalName: true } },
      },
      orderBy: { similarity: "desc" },
    });
    return rows.map(toDuplicateRow);
  }

  async upsertDuplicateCandidate(input: {
    readonly leftNodeRecordId: string;
    readonly rightNodeRecordId: string;
    readonly similarity: number;
    readonly detectionMethod: "NormalizedName" | "AliasOverlap" | "FullTextSimilarity" | "Manual";
    readonly now: Date;
  }): Promise<GraphDuplicateCandidateRow> {
    const db = getTenantDb(OPERATION);
    // `UQ_GraphDuplicateCandidates_pair` keys on the ORDERED pair (LEAST/GREATEST of the two
    // node ids, computed at the database — absent from this Prisma model by design, see the
    // schema's own doc comment) — so the application-layer match must check both orderings.
    const existing = await db.graphDuplicateCandidate.findFirst({
      where: {
        OR: [
          { leftNodeRecordId: input.leftNodeRecordId, rightNodeRecordId: input.rightNodeRecordId },
          { leftNodeRecordId: input.rightNodeRecordId, rightNodeRecordId: input.leftNodeRecordId },
        ],
      },
      include: {
        leftNode: { select: { canonicalName: true } },
        rightNode: { select: { canonicalName: true } },
      },
    });
    if (existing) {
      const updated = await db.graphDuplicateCandidate.update({
        where: { id: existing.id },
        data: { similarity: input.similarity, detectedAt: input.now, updatedAt: input.now },
        include: {
          leftNode: { select: { canonicalName: true } },
          rightNode: { select: { canonicalName: true } },
        },
      });
      return toDuplicateRow(updated);
    }
    const created = await db.graphDuplicateCandidate.create({
      data: {
        id: newUlid(input.now),
        leftNodeRecordId: input.leftNodeRecordId,
        rightNodeRecordId: input.rightNodeRecordId,
        similarity: input.similarity,
        detectionMethod: input.detectionMethod,
        state: "Open",
        detectedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
      include: {
        leftNode: { select: { canonicalName: true } },
        rightNode: { select: { canonicalName: true } },
      },
    });
    return toDuplicateRow(created);
  }

  async setDuplicateCandidateState(
    id: string,
    state: "Open" | "Merged" | "Ignored",
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.graphDuplicateCandidate.update({ where: { id }, data: { state, updatedAt: now } });
  }

  async getDuplicateCandidate(id: string): Promise<GraphDuplicateCandidateRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.graphDuplicateCandidate.findFirst({
      where: { id },
      include: {
        leftNode: { select: { canonicalName: true } },
        rightNode: { select: { canonicalName: true } },
      },
    });
    return row ? toDuplicateRow(row) : null;
  }

  async recordMergeDecision(input: {
    readonly graphDuplicateCandidateId: string;
    readonly decision: "Merge" | "Ignore";
    readonly survivingNodeRecordId: string | null;
    readonly absorbedNodeRecordId: string | null;
    readonly decidedByStaffUserId: string;
    readonly now: Date;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.graphMergeDecision.create({
      data: {
        id: newUlid(input.now),
        graphDuplicateCandidateId: input.graphDuplicateCandidateId,
        decision: input.decision,
        survivingNodeRecordId: input.survivingNodeRecordId,
        absorbedNodeRecordId: input.absorbedNodeRecordId,
        aliasesAddedJson: null,
        edgesRewiredCount: 0,
        decidedByStaffUserId: input.decidedByStaffUserId,
        decidedAt: input.now,
        reindexJobId: null,
        revertedAt: null,
        revertedByStaffUserId: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    if (input.decision === "Merge" && input.absorbedNodeRecordId && input.survivingNodeRecordId) {
      await db.graphNodeRecord.update({
        where: { id: input.absorbedNodeRecordId },
        data: {
          mergedIntoNodeRecordId: input.survivingNodeRecordId,
          mergedAt: input.now,
          updatedAt: input.now,
        },
      });
    }
  }
}
