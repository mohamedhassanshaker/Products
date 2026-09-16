/** The real `ConflictRepository` — `SourceConflicts`, B6 tab 4, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { isConflictPolicy, isConflictStatus } from "../../../domain/knowledge-catalog.js";
import type { ConflictRepository, SourceConflictRow } from "../../../ports/conflict-repository.js";

const OPERATION = "knowledge conflict repository";

function toConflictRow(row: {
  id: string;
  topic: string;
  graphEntityKey: string;
  sideAChunkId: string;
  sideAKnowledgeSourceId: string;
  sideAKnowledgeSource: { name: string };
  sideAValue: string;
  sideASourceUpdatedAt: Date;
  sideBChunkId: string;
  sideBKnowledgeSourceId: string;
  sideBKnowledgeSource: { name: string };
  sideBValue: string;
  sideBSourceUpdatedAt: Date;
  detectedAt: Date;
  status: string;
  policyAtDetection: string;
  authoritativeSide: string | null;
  resolvedByStaffUserId: string | null;
  resolvedAt: Date | null;
  groundingPenalty: unknown;
}): SourceConflictRow {
  if (
    !isConflictStatus(row.status) ||
    !isConflictPolicy(row.policyAtDetection) ||
    (row.authoritativeSide !== null &&
      row.authoritativeSide !== "A" &&
      row.authoritativeSide !== "B")
  ) {
    throw new Error(
      `SourceConflict ${row.id} has an unrecognized status/policyAtDetection/authoritativeSide.`,
    );
  }
  return {
    id: row.id,
    topic: row.topic,
    graphEntityKey: row.graphEntityKey,
    sideAChunkId: row.sideAChunkId,
    sideAKnowledgeSourceId: row.sideAKnowledgeSourceId,
    sideAKnowledgeSourceName: row.sideAKnowledgeSource.name,
    sideAValue: row.sideAValue,
    sideASourceUpdatedAt: row.sideASourceUpdatedAt,
    sideBChunkId: row.sideBChunkId,
    sideBKnowledgeSourceId: row.sideBKnowledgeSourceId,
    sideBKnowledgeSourceName: row.sideBKnowledgeSource.name,
    sideBValue: row.sideBValue,
    sideBSourceUpdatedAt: row.sideBSourceUpdatedAt,
    detectedAt: row.detectedAt,
    status: row.status,
    policyAtDetection: row.policyAtDetection,
    authoritativeSide: row.authoritativeSide,
    resolvedByStaffUserId: row.resolvedByStaffUserId,
    resolvedAt: row.resolvedAt,
    groundingPenalty: Number(row.groundingPenalty),
  };
}

const INCLUDE = {
  sideAKnowledgeSource: { select: { name: true } },
  sideBKnowledgeSource: { select: { name: true } },
} as const;

export class PrismaConflictRepository implements ConflictRepository {
  async list(): Promise<readonly SourceConflictRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.sourceConflict.findMany({
      include: INCLUDE,
      orderBy: { detectedAt: "desc" },
    });
    return rows.map(toConflictRow);
  }

  async get(id: string): Promise<SourceConflictRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.sourceConflict.findFirst({ where: { id }, include: INCLUDE });
    return row ? toConflictRow(row) : null;
  }

  async resolve(input: {
    readonly id: string;
    readonly authoritativeSide: "A" | "B";
    readonly resolvedByStaffUserId: string;
    readonly now: Date;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: "knowledge.conflict_not_open" }
  > {
    const db = getTenantDb(OPERATION);
    const existing = await db.sourceConflict.findFirst({ where: { id: input.id } });
    if (!existing || existing.status !== "Open") {
      return { ok: false, reason: "knowledge.conflict_not_open" };
    }
    await db.sourceConflict.update({
      where: { id: input.id },
      data: {
        status: "Resolved",
        authoritativeSide: input.authoritativeSide,
        resolvedByStaffUserId: input.resolvedByStaffUserId,
        resolvedAt: input.now,
        updatedAt: input.now,
      },
    });
    return { ok: true };
  }
}
