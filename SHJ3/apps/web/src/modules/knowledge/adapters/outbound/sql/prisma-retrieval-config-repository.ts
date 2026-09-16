/** The real `RetrievalConfigRepository` — `RetrievalConfigs`/`RetrievalPlaygroundRuns`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isConflictPolicy } from "../../../domain/knowledge-catalog.js";
import { RETRIEVAL_CONFIG_DEFAULTS } from "../../../domain/retrieval-config.js";
import type {
  NewPlaygroundRunInput,
  RetrievalConfigRepository,
  RetrievalConfigRow,
  UpdateRetrievalConfigInput,
} from "../../../ports/retrieval-config-repository.js";

const OPERATION = "knowledge retrieval config repository";

function toConfigRow(row: {
  id: string;
  scope: string;
  knowledgeCollectionId: string | null;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  embeddingModel: string;
  embeddingDimension: number;
  graphWeight: unknown;
  vectorWeight: unknown;
  topK: number;
  rerankerEnabled: boolean;
  rerankerModel: string | null;
  rerankCandidateCount: number;
  minGroundingConfidence: unknown;
  defaultConflictPolicy: string;
  maxGraphHops: number;
}): RetrievalConfigRow {
  if (
    (row.scope !== "Tenant" && row.scope !== "Collection") ||
    !isConflictPolicy(row.defaultConflictPolicy)
  ) {
    throw new Error(`RetrievalConfig ${row.id} has an unrecognized scope/defaultConflictPolicy.`);
  }
  return {
    id: row.id,
    scope: row.scope,
    knowledgeCollectionId: row.knowledgeCollectionId,
    chunkSizeTokens: row.chunkSizeTokens,
    chunkOverlapTokens: row.chunkOverlapTokens,
    embeddingModel: row.embeddingModel,
    embeddingDimension: row.embeddingDimension,
    graphWeight: Number(row.graphWeight),
    vectorWeight: Number(row.vectorWeight),
    topK: row.topK,
    rerankerEnabled: row.rerankerEnabled,
    rerankerModel: row.rerankerModel,
    rerankCandidateCount: row.rerankCandidateCount,
    minGroundingConfidence: Number(row.minGroundingConfidence),
    defaultConflictPolicy: row.defaultConflictPolicy,
    maxGraphHops: row.maxGraphHops,
  };
}

export class PrismaRetrievalConfigRepository implements RetrievalConfigRepository {
  async ensureTenantConfig(now: Date): Promise<RetrievalConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.retrievalConfig.findFirst({ where: { scope: "Tenant" } });
    if (existing) return toConfigRow(existing);

    const d = RETRIEVAL_CONFIG_DEFAULTS;
    const created = await db.retrievalConfig.create({
      data: {
        id: newUlid(now),
        scope: "Tenant",
        knowledgeCollectionId: null,
        chunkSizeTokens: d.chunkSizeTokens,
        chunkOverlapTokens: d.chunkOverlapTokens,
        embeddingModel: d.embeddingModel,
        embeddingDimension: d.embeddingDimension,
        graphWeight: d.graphWeight,
        vectorWeight: d.vectorWeight,
        topK: d.topK,
        rerankerEnabled: d.rerankerEnabled,
        rerankerModel: d.rerankerModel,
        rerankCandidateCount: d.rerankCandidateCount,
        minGroundingConfidence: d.minGroundingConfidence,
        defaultConflictPolicy: d.defaultConflictPolicy,
        maxGraphHops: d.maxGraphHops,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toConfigRow(created);
  }

  async updateTenantConfig(input: UpdateRetrievalConfigInput): Promise<RetrievalConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.retrievalConfig.findFirstOrThrow({ where: { scope: "Tenant" } });
    // TR_RetrievalConfigs_modelChangeQueuesReindex fires on this UPDATE statement, at the
    // database, when embeddingModel/embeddingDimension changes — see this port's own doc
    // comment for why nothing here duplicates that insert.
    const updated = await db.retrievalConfig.update({
      where: { id: existing.id },
      data: {
        chunkSizeTokens: input.chunkSizeTokens,
        chunkOverlapTokens: input.chunkOverlapTokens,
        embeddingModel: input.embeddingModel,
        embeddingDimension: input.embeddingDimension,
        graphWeight: input.graphWeight,
        vectorWeight: input.vectorWeight,
        topK: input.topK,
        rerankerEnabled: input.rerankerEnabled,
        rerankerModel: input.rerankerModel,
        rerankCandidateCount: input.rerankCandidateCount,
        minGroundingConfidence: input.minGroundingConfidence,
        defaultConflictPolicy: input.defaultConflictPolicy,
        maxGraphHops: input.maxGraphHops,
        updatedAt: input.now,
      },
    });
    return toConfigRow(updated);
  }

  async recordPlaygroundRun(input: NewPlaygroundRunInput): Promise<{ readonly id: string }> {
    const db = getTenantDb(OPERATION);
    const created = await db.retrievalPlaygroundRun.create({
      data: {
        id: newUlid(input.now),
        query: input.query,
        configSnapshotJson: input.configSnapshotJson,
        resultsJson: input.resultsJson,
        matchedSubgraph: input.matchedSubgraph,
        topScore: input.topScore,
        ranByStaffUserId: input.ranByStaffUserId,
        durationMs: input.durationMs,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return { id: created.id };
  }
}
