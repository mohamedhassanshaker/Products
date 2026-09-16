/** `RetrievalConfigs`/`RetrievalPlaygroundRuns` — B6 tab 3. */

import type { ConflictPolicy } from "../domain/knowledge-catalog.js";

export interface RetrievalConfigRow {
  readonly id: string;
  readonly scope: "Tenant" | "Collection";
  readonly knowledgeCollectionId: string | null;
  readonly chunkSizeTokens: number;
  readonly chunkOverlapTokens: number;
  readonly embeddingModel: string;
  readonly embeddingDimension: number;
  readonly graphWeight: number;
  readonly vectorWeight: number;
  readonly topK: number;
  readonly rerankerEnabled: boolean;
  readonly rerankerModel: string | null;
  readonly rerankCandidateCount: number;
  readonly minGroundingConfidence: number;
  readonly defaultConflictPolicy: ConflictPolicy;
  readonly maxGraphHops: number;
}

export interface UpdateRetrievalConfigInput {
  readonly chunkSizeTokens: number;
  readonly chunkOverlapTokens: number;
  readonly embeddingModel: string;
  readonly embeddingDimension: number;
  readonly graphWeight: number;
  readonly vectorWeight: number;
  readonly topK: number;
  readonly rerankerEnabled: boolean;
  readonly rerankerModel: string | null;
  readonly rerankCandidateCount: number;
  readonly minGroundingConfidence: number;
  readonly defaultConflictPolicy: ConflictPolicy;
  readonly maxGraphHops: number;
  readonly now: Date;
}

export interface NewPlaygroundRunInput {
  readonly query: string;
  readonly configSnapshotJson: string;
  readonly resultsJson: string;
  readonly matchedSubgraph: string | null;
  readonly topScore: number | null;
  readonly ranByStaffUserId: string;
  readonly durationMs: number;
  readonly now: Date;
}

export interface RetrievalConfigRepository {
  /** Creates the tenant-scope row with `RETRIEVAL_CONFIG_DEFAULTS` on first use. There is exactly one `Tenant`-scope row per tenant (`UQ_RetrievalConfigs_tenantScope`); this wave never creates a `Collection`-scope override. */
  ensureTenantConfig(now: Date): Promise<RetrievalConfigRow>;

  /**
   * `TR_RetrievalConfigs_modelChangeQueuesReindex` fires at the database on this same
   * UPDATE statement when `embeddingModel`/`embeddingDimension` changes — nothing here
   * creates that `ReindexJob` itself (see `application/update-retrieval-config.ts`'s own
   * doc comment for why duplicating the trigger's insert at this layer would be actively
   * wrong, not merely redundant).
   */
  updateTenantConfig(input: UpdateRetrievalConfigInput): Promise<RetrievalConfigRow>;

  recordPlaygroundRun(input: NewPlaygroundRunInput): Promise<{ readonly id: string }>;
}
