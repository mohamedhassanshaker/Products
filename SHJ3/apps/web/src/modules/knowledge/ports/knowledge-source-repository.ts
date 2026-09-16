/** `KnowledgeCollections`/`KnowledgeSources`/`IngestionRuns` — B6 tab 1. */

import type { SourceSchedule, SourceStatus, SourceType } from "../domain/knowledge-catalog.js";

export interface KnowledgeCollectionRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface KnowledgeSourceRow {
  readonly id: string;
  readonly knowledgeCollectionId: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly location: string;
  readonly schedule: SourceSchedule;
  readonly status: SourceStatus;
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly indexedChunkCount: number;
  /** `TR_Chunks_recountSource`'s computed column — never written by application code. */
  readonly indexedPercent: number;
  readonly lastCrawledAt: Date | null;
  readonly nextScheduledAt: Date | null;
  readonly lastError: string | null;
  readonly credentialSecretRef: string | null;
  readonly removedAt: Date | null;
}

export interface NewKnowledgeSourceInput {
  readonly knowledgeCollectionId: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly location: string;
  readonly schedule: SourceSchedule;
  readonly credentialSecretRef: string | null;
  readonly now: Date;
}

export interface NewIngestionRunInput {
  readonly knowledgeSourceId: string;
  readonly trigger: "Manual" | "Schedule" | "ReindexAll" | "Reconciliation";
  readonly startedAt: Date;
  readonly ranByStaffUserId: string | null;
}

export interface IngestionRunRow {
  readonly id: string;
  readonly knowledgeSourceId: string;
  readonly state: "Queued" | "Running" | "Completed" | "Failed";
}

export interface CompleteIngestionRunInput {
  readonly id: string;
  readonly state: "Completed" | "Failed";
  readonly documentsSeen: number;
  readonly documentsAdded: number;
  readonly documentsUpdated: number;
  readonly documentsRemoved: number;
  readonly chunksWritten: number;
  readonly chunksSkippedUnchanged: number;
  readonly error: string | null;
  readonly finishedAt: Date;
}

export interface KnowledgeSourceRepository {
  /** Every non-removed source the tenant owns, across every collection — B6 tab 1's whole table. */
  listSources(): Promise<readonly KnowledgeSourceRow[]>;
  getSource(id: string): Promise<KnowledgeSourceRow | null>;

  /**
   * Returns the tenant's one `KnowledgeCollection`, creating it (named after the tenant,
   * slug `"default"`) on first use. B6's wireframe shows one collection per tenant in
   * practice — nothing in this wave's scope asks for a collection-management screen, so
   * sources are always added into this single, lazily-created collection.
   */
  ensureDefaultCollection(now: Date): Promise<KnowledgeCollectionRow>;

  createSource(input: NewKnowledgeSourceInput): Promise<KnowledgeSourceRow>;
  setStatus(id: string, status: SourceStatus, now: Date): Promise<void>;
  recordLastError(id: string, error: string | null, now: Date): Promise<void>;

  /** FR-KNOW-04: soft-delete — chunks/citations still point at the row, so it is marked `removedAt`, never physically deleted. */
  softDeleteSource(id: string, now: Date): Promise<void>;

  startIngestionRun(input: NewIngestionRunInput): Promise<IngestionRunRow>;
  /** Also stamps the owning source's `lastCrawledAt`/`status` from the run's outcome (§9.4: "set from `IngestionRuns.finishedAt`, never from the click"). */
  completeIngestionRun(input: CompleteIngestionRunInput): Promise<void>;
  listIngestionRuns(knowledgeSourceId: string): Promise<
    readonly {
      readonly id: string;
      readonly trigger: string;
      readonly state: string;
      readonly startedAt: Date;
      readonly finishedAt: Date | null;
      readonly error: string | null;
    }[]
  >;
}
