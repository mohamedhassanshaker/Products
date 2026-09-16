/** `ReindexJobs` — B6 tab 3's job history table. */

import type { ReindexJobState, ReindexReason, ReindexScope } from "../domain/knowledge-catalog.js";

export interface ReindexJobRow {
  readonly id: string;
  readonly scope: ReindexScope;
  readonly knowledgeSourceId: string | null;
  readonly knowledgeCollectionId: string | null;
  readonly reason: ReindexReason;
  readonly state: ReindexJobState;
  readonly progressPercent: number;
  readonly chunksTotal: number | null;
  readonly chunksProcessed: number;
  readonly targetEmbeddingModel: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly error: string | null;
  readonly ranByStaffUserId: string | null;
  readonly createdAt: Date;
}

export interface NewReindexJobInput {
  readonly scope: ReindexScope;
  readonly knowledgeSourceId: string | null;
  readonly knowledgeCollectionId: string | null;
  readonly reason: ReindexReason;
  readonly targetEmbeddingModel: string | null;
  readonly ranByStaffUserId: string | null;
  readonly now: Date;
}

export interface UpdateReindexJobProgressInput {
  readonly id: string;
  readonly state: ReindexJobState;
  readonly progressPercent: number;
  readonly chunksTotal: number | null;
  readonly chunksProcessed: number;
  readonly error: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface ReindexJobRepository {
  create(input: NewReindexJobInput): Promise<ReindexJobRow>;
  get(id: string): Promise<ReindexJobRow | null>;
  updateProgress(input: UpdateReindexJobProgressInput): Promise<void>;
  list(): Promise<readonly ReindexJobRow[]>;
  /** `UQ_ReindexJobs_activeTenantScope (scope) WHERE scope='Tenant' AND state IN ('Queued','Running')`'s read-side mirror — used to refuse a second concurrent tenant-wide re-index rather than let the database reject it as an opaque constraint violation. */
  findActiveTenantScopeJob(): Promise<ReindexJobRow | null>;
}
