/**
 * `SourceDocuments`/`Chunks` — the system of record §9.1's write ordering protects.
 * `Chunk.text` is authoritative (never copied whole into Qdrant/Neo4j, ADR-0003), which is
 * why `reconstructDocumentText` (domain layer) can rebuild a `Document` source's original
 * text from rows this port already returns.
 */

import type { DerivedIndexState } from "../domain/knowledge-catalog.js";

export interface NewSourceDocumentInput {
  readonly knowledgeSourceId: string;
  readonly externalRef: string;
  readonly title: string | null;
  readonly contentHash: string;
  readonly byteSize: bigint;
  readonly mimeType: string;
  readonly localeCode: string | null;
  /** No blob store exists (see `domain/document-reconstruction.ts`) — `storageRef` is a stable, human-legible reference, not a fetchable location, for the one source type this wave wires end to end. */
  readonly storageRef: string;
  readonly fetchedAt: Date;
  /** The prior `SourceDocument` this one replaces, if any (re-crawl). */
  readonly supersedesDocumentId: string | null;
  readonly now: Date;
}

export interface SourceDocumentRow {
  readonly id: string;
  readonly knowledgeSourceId: string;
  readonly contentHash: string;
  readonly supersededAt: Date | null;
}

export interface NewChunkInput {
  readonly sourceDocumentId: string;
  readonly knowledgeSourceId: string;
  readonly knowledgeCollectionId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly tokenCount: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly contentHash: string;
  readonly sectionPath: string | null;
  readonly pageNumber: number | null;
  readonly localeCode: string;
}

export interface ChunkRow {
  readonly id: string;
  readonly sourceDocumentId: string;
  readonly knowledgeSourceId: string;
  readonly knowledgeCollectionId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly sectionPath: string | null;
  readonly pageNumber: number | null;
  readonly localeCode: string;
  readonly embeddingModel: string | null;
  readonly embeddingDimension: number | null;
  readonly vectorState: DerivedIndexState;
  readonly graphState: DerivedIndexState;
  readonly erasedAt: Date | null;
}

export interface ApplyEmbedResultInput {
  readonly chunkId: string;
  readonly vectorState: DerivedIndexState;
  readonly graphState: DerivedIndexState;
  readonly embeddingModel: string;
  readonly embeddingDimension: number;
  readonly now: Date;
}

export interface ChunkRepository {
  /**
   * Writes one `SourceDocument` plus its `Chunks` (state `'Pending'`/`'Pending'`) plus one
   * `OutboxEvent` per chunk (`aggregateKind: 'Chunk'`, `eventType: 'ChunkUpserted'`,
   * `targetStore: 'Both'`) **in a single transaction** — §9.2's write-ordering invariant:
   * the domain row and its outbox intent commit together or not at all.
   */
  createDocumentWithChunks(input: {
    readonly document: NewSourceDocumentInput;
    readonly chunks: readonly Omit<NewChunkInput, "sourceDocumentId">[];
  }): Promise<{ readonly document: SourceDocumentRow; readonly chunks: readonly ChunkRow[] }>;

  listChunksBySource(knowledgeSourceId: string): Promise<readonly ChunkRow[]>;
  listChunksByIds(ids: readonly string[]): Promise<readonly ChunkRow[]>;
  /** Every non-erased chunk across the whole tenant — `RunReindexJob`'s `Tenant`/`Collection`-scope source, filtered in the application layer rather than the repository so the one method serves every scope. */
  listAllChunks(): Promise<readonly ChunkRow[]>;

  /** Applies one `embed-and-index` response row onto its `Chunk` — the second half of §9.2 step 6. */
  applyEmbedResult(input: ApplyEmbedResultInput): Promise<void>;

  /** Reconciliation's "missing" repair (§9.3 step 3): reset to `Pending` and let the normal outbox path re-apply. Does not itself insert the fresh `OutboxEvent` — see `OutboxRepository.enqueueChunkUpsert`. */
  resetToPending(chunkIds: readonly string[], now: Date): Promise<void>;

  /** Marks chunks erased (FR-KNOW-04 cascade: no remaining supporting source). */
  markErased(chunkIds: readonly string[], now: Date): Promise<void>;

  /** True if any non-erased chunk anywhere in the tenant still references this `sourceDocumentId`'s originating source other than `excludingSourceId` — used by source removal's "no other source supports them" check, scoped by content rather than id since entity support is graph-level, not row-level; see `remove-source.ts` for how this is actually used. */
  countNonErasedChunksForSource(knowledgeSourceId: string): Promise<number>;
}
