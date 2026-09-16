/** The real `KnowledgeSourceRepository` — `KnowledgeCollections`/`KnowledgeSources`/`IngestionRuns`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isSourceSchedule,
  isSourceStatus,
  isSourceType,
  type SourceStatus,
} from "../../../domain/knowledge-catalog.js";
import type {
  CompleteIngestionRunInput,
  IngestionRunRow,
  KnowledgeCollectionRow,
  KnowledgeSourceRepository,
  KnowledgeSourceRow,
  NewIngestionRunInput,
  NewKnowledgeSourceInput,
} from "../../../ports/knowledge-source-repository.js";

const OPERATION = "knowledge source repository";
const DEFAULT_COLLECTION_SLUG = "default";

/** `TR_Chunks_recountSource`'s formula, mirrored in TypeScript rather than read via raw SQL: `chunkCount`/`indexedChunkCount` are ordinary typed columns the trigger keeps in sync, and computing the same CASE expression from them here avoids a second, redundant raw-SQL read path for one derived number (`prisma/tenant/schema.prisma`'s own `KnowledgeSource` doc comment names the exact formula this reproduces). */
function indexedPercentOf(chunkCount: number, indexedChunkCount: number): number {
  return chunkCount === 0 ? 0 : Math.floor((indexedChunkCount * 100) / chunkCount);
}

function toSourceRow(row: {
  id: string;
  knowledgeCollectionId: string;
  name: string;
  sourceType: string;
  location: string;
  schedule: string;
  status: string;
  documentCount: number;
  chunkCount: number;
  indexedChunkCount: number;
  lastCrawledAt: Date | null;
  nextScheduledAt: Date | null;
  lastError: string | null;
  credentialSecretRef: string | null;
  removedAt: Date | null;
}): KnowledgeSourceRow {
  if (
    !isSourceType(row.sourceType) ||
    !isSourceSchedule(row.schedule) ||
    !isSourceStatus(row.status)
  ) {
    throw new Error(`KnowledgeSource ${row.id} has an unrecognized sourceType/schedule/status.`);
  }
  return {
    id: row.id,
    knowledgeCollectionId: row.knowledgeCollectionId,
    name: row.name,
    sourceType: row.sourceType,
    location: row.location,
    schedule: row.schedule,
    status: row.status,
    documentCount: row.documentCount,
    chunkCount: row.chunkCount,
    indexedChunkCount: row.indexedChunkCount,
    indexedPercent: indexedPercentOf(row.chunkCount, row.indexedChunkCount),
    lastCrawledAt: row.lastCrawledAt,
    nextScheduledAt: row.nextScheduledAt,
    lastError: row.lastError,
    credentialSecretRef: row.credentialSecretRef,
    removedAt: row.removedAt,
  };
}

export class PrismaKnowledgeSourceRepository implements KnowledgeSourceRepository {
  async listSources(): Promise<readonly KnowledgeSourceRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.knowledgeSource.findMany({
      where: { removedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toSourceRow);
  }

  async getSource(id: string): Promise<KnowledgeSourceRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.knowledgeSource.findFirst({ where: { id, removedAt: null } });
    return row ? toSourceRow(row) : null;
  }

  async ensureDefaultCollection(now: Date): Promise<KnowledgeCollectionRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.knowledgeCollection.findFirst({
      where: { slug: DEFAULT_COLLECTION_SLUG, deletedAt: null },
    });
    if (existing) return { id: existing.id, name: existing.name, slug: existing.slug };

    // `TenantProfile` mirrors `platform.Tenants.id` into every tenant schema exactly so a
    // tenant-scoped write can populate its own `ownerTenantId` FK without needing
    // `getPlatformDb()`'s `platformScope` gate — the identical technique
    // `(backoffice)/agents/composition.ts`'s `resolveOwnerTenantId` already establishes.
    const profile = await db.tenantProfile.findUniqueOrThrow({ where: { singletonKey: 1 } });

    const created = await db.knowledgeCollection.create({
      data: {
        id: newUlid(now),
        name: `${profile.displayName} knowledge base`,
        slug: DEFAULT_COLLECTION_SLUG,
        description: null,
        ownerTenantId: profile.tenantId,
        retrievalConfigId: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return { id: created.id, name: created.name, slug: created.slug };
  }

  async createSource(input: NewKnowledgeSourceInput): Promise<KnowledgeSourceRow> {
    const db = getTenantDb(OPERATION);
    const profile = await db.tenantProfile.findUniqueOrThrow({ where: { singletonKey: 1 } });
    const created = await db.knowledgeSource.create({
      data: {
        id: newUlid(input.now),
        knowledgeCollectionId: input.knowledgeCollectionId,
        name: input.name,
        sourceType: input.sourceType,
        location: input.location,
        ownerTenantId: profile.tenantId,
        schedule: input.schedule,
        // FR-KNOW-02: "A newly added source begins at 0% indexed with an ingestion job
        // queued" — status starts Idle; the caller (AddSource) queues the actual run.
        status: "Idle",
        documentCount: 0,
        chunkCount: 0,
        indexedChunkCount: 0,
        lastCrawledAt: null,
        nextScheduledAt: null,
        lastError: null,
        credentialSecretRef: input.credentialSecretRef,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toSourceRow(created);
  }

  async setStatus(id: string, status: SourceStatus, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.knowledgeSource.update({ where: { id }, data: { status, updatedAt: now } });
  }

  async recordLastError(id: string, error: string | null, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.knowledgeSource.update({ where: { id }, data: { lastError: error, updatedAt: now } });
  }

  async softDeleteSource(id: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.knowledgeSource.update({ where: { id }, data: { removedAt: now, updatedAt: now } });
  }

  async startIngestionRun(input: NewIngestionRunInput): Promise<IngestionRunRow> {
    const db = getTenantDb(OPERATION);
    const created = await db.ingestionRun.create({
      data: {
        id: newUlid(input.startedAt),
        knowledgeSourceId: input.knowledgeSourceId,
        trigger: input.trigger,
        state: "Running",
        documentsSeen: 0,
        documentsAdded: 0,
        documentsUpdated: 0,
        documentsRemoved: 0,
        chunksWritten: 0,
        chunksSkippedUnchanged: 0,
        startedAt: input.startedAt,
        finishedAt: null,
        error: null,
        ranByStaffUserId: input.ranByStaffUserId,
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
      },
    });
    return { id: created.id, knowledgeSourceId: created.knowledgeSourceId, state: "Running" };
  }

  async completeIngestionRun(input: CompleteIngestionRunInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    const run = await db.ingestionRun.update({
      where: { id: input.id },
      data: {
        state: input.state,
        documentsSeen: input.documentsSeen,
        documentsAdded: input.documentsAdded,
        documentsUpdated: input.documentsUpdated,
        documentsRemoved: input.documentsRemoved,
        chunksWritten: input.chunksWritten,
        chunksSkippedUnchanged: input.chunksSkippedUnchanged,
        error: input.error,
        finishedAt: input.finishedAt,
        updatedAt: input.finishedAt,
      },
    });
    // §9.4: "set from IngestionRuns.finishedAt, never from the click."
    await db.knowledgeSource.update({
      where: { id: run.knowledgeSourceId },
      data: {
        status: input.state === "Completed" ? "Idle" : "Failed",
        ...(input.state === "Completed" ? { lastCrawledAt: input.finishedAt } : {}),
        lastError: input.error,
        updatedAt: input.finishedAt,
      },
    });
  }

  async listIngestionRuns(knowledgeSourceId: string) {
    const db = getTenantDb(OPERATION);
    const rows = await db.ingestionRun.findMany({
      where: { knowledgeSourceId },
      orderBy: { startedAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      state: row.state,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      error: row.error,
    }));
  }
}
