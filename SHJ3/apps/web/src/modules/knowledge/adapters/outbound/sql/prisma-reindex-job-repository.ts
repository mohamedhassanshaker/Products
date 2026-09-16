/** The real `ReindexJobRepository` — `ReindexJobs`, B6 tab 3's job history, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isReindexJobState,
  isReindexReason,
  isReindexScope,
} from "../../../domain/knowledge-catalog.js";
import type {
  NewReindexJobInput,
  ReindexJobRepository,
  ReindexJobRow,
  UpdateReindexJobProgressInput,
} from "../../../ports/reindex-job-repository.js";

const OPERATION = "knowledge reindex job repository";

function toJobRow(row: {
  id: string;
  scope: string;
  knowledgeSourceId: string | null;
  knowledgeCollectionId: string | null;
  reason: string;
  state: string;
  progressPercent: number;
  chunksTotal: number | null;
  chunksProcessed: number;
  targetEmbeddingModel: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  ranByStaffUserId: string | null;
  createdAt: Date;
}): ReindexJobRow {
  if (!isReindexScope(row.scope) || !isReindexReason(row.reason) || !isReindexJobState(row.state)) {
    throw new Error(`ReindexJob ${row.id} has an unrecognized scope/reason/state.`);
  }
  return {
    id: row.id,
    scope: row.scope,
    knowledgeSourceId: row.knowledgeSourceId,
    knowledgeCollectionId: row.knowledgeCollectionId,
    reason: row.reason,
    state: row.state,
    progressPercent: row.progressPercent,
    chunksTotal: row.chunksTotal,
    chunksProcessed: row.chunksProcessed,
    targetEmbeddingModel: row.targetEmbeddingModel,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    ranByStaffUserId: row.ranByStaffUserId,
    createdAt: row.createdAt,
  };
}

export class PrismaReindexJobRepository implements ReindexJobRepository {
  async create(input: NewReindexJobInput): Promise<ReindexJobRow> {
    const db = getTenantDb(OPERATION);
    const created = await db.reindexJob.create({
      data: {
        id: newUlid(input.now),
        scope: input.scope,
        knowledgeSourceId: input.knowledgeSourceId,
        knowledgeCollectionId: input.knowledgeCollectionId,
        reason: input.reason,
        state: "Queued",
        progressPercent: 0,
        chunksTotal: null,
        chunksProcessed: 0,
        targetEmbeddingModel: input.targetEmbeddingModel,
        startedAt: null,
        finishedAt: null,
        error: null,
        ranByStaffUserId: input.ranByStaffUserId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toJobRow(created);
  }

  async updateProgress(input: UpdateReindexJobProgressInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.reindexJob.update({
      where: { id: input.id },
      data: {
        state: input.state,
        progressPercent: input.progressPercent,
        chunksTotal: input.chunksTotal,
        chunksProcessed: input.chunksProcessed,
        error: input.error,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        updatedAt: input.finishedAt ?? input.startedAt ?? new Date(),
      },
    });
  }

  async get(id: string): Promise<ReindexJobRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.reindexJob.findFirst({ where: { id } });
    return row ? toJobRow(row) : null;
  }

  async list(): Promise<readonly ReindexJobRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.reindexJob.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toJobRow);
  }

  async findActiveTenantScopeJob(): Promise<ReindexJobRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.reindexJob.findFirst({
      where: { scope: "Tenant", state: { in: ["Queued", "Running"] } },
    });
    return row ? toJobRow(row) : null;
  }
}
