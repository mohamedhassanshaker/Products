/**
 * "Re-crawl now" — B6 tab 1 (FR-KNOW-03). For the one source type this wave wires end to
 * end (`Document`), this means exactly what the wave's scope note promises: **re-chunk the
 * same stored text.** There is no blob store in this codebase (`domain/document-
 * reconstruction.ts`'s own doc comment), so the original text is rebuilt from the source's
 * already-stored `Chunks` before re-chunking — an exact reconstruction, not an
 * approximation, given chunking's forward-only, gapless offsets.
 *
 * The prior live `SourceDocument`/`Chunks` are superseded/erased rather than deleted
 * outright, matching every other soft-delete convention in this schema.
 */

import { createHash, randomUUID } from "node:crypto";
import { reconstructDocumentText } from "../domain/document-reconstruction.js";
import { FULLY_WIRED_SOURCE_TYPE } from "../domain/knowledge-catalog.js";
import type { ChunkRepository } from "../ports/chunk-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type {
  KnowledgeSourceRepository,
  KnowledgeSourceRow,
} from "../ports/knowledge-source-repository.js";
import type { RetrievalConfigRepository } from "../ports/retrieval-config-repository.js";

export interface RecrawlSourceInput {
  readonly knowledgeSourceId: string;
  readonly ranByStaffUserId: string;
  readonly now: Date;
}

export type RecrawlSourceResult =
  | { readonly ok: true; readonly source: KnowledgeSourceRow; readonly chunksWritten: number }
  | { readonly ok: false; readonly reason: "knowledge.source_not_found" }
  | { readonly ok: false; readonly reason: "knowledge.recrawl_not_supported_for_source_type" }
  | { readonly ok: false; readonly reason: "knowledge.no_stored_text_to_recrawl" };

export interface RecrawlSourceDeps {
  readonly sources: KnowledgeSourceRepository;
  readonly chunks: ChunkRepository;
  readonly retrievalConfig: RetrievalConfigRepository;
  readonly ai: KnowledgeAiClient;
}

export class RecrawlSource {
  constructor(private readonly deps: RecrawlSourceDeps) {}

  async execute(input: RecrawlSourceInput): Promise<RecrawlSourceResult> {
    const source = await this.deps.sources.getSource(input.knowledgeSourceId);
    if (!source) return { ok: false, reason: "knowledge.source_not_found" };
    if (source.sourceType !== FULLY_WIRED_SOURCE_TYPE) {
      return { ok: false, reason: "knowledge.recrawl_not_supported_for_source_type" };
    }

    const existingChunks = await this.deps.chunks.listChunksBySource(source.id);
    const reconstructed = reconstructDocumentText(existingChunks);
    if (!reconstructed.ok) return { ok: false, reason: "knowledge.no_stored_text_to_recrawl" };

    const liveDocumentId = existingChunks[0]?.sourceDocumentId ?? null;
    const localeCode = existingChunks[0]?.localeCode ?? "en";

    const run = await this.deps.sources.startIngestionRun({
      knowledgeSourceId: source.id,
      trigger: "Manual",
      startedAt: input.now,
      ranByStaffUserId: input.ranByStaffUserId,
    });
    await this.deps.sources.setStatus(source.id, "Indexing", input.now);

    const config = await this.deps.retrievalConfig.ensureTenantConfig(input.now);

    try {
      const chunked = await this.deps.ai.chunkDocument({
        documentText: reconstructed.text,
        chunkSizeTokens: config.chunkSizeTokens,
        chunkOverlapTokens: config.chunkOverlapTokens,
        localeCode,
      });

      const documentBytes = Buffer.byteLength(reconstructed.text, "utf8");
      const { chunks: newChunks } = await this.deps.chunks.createDocumentWithChunks({
        document: {
          knowledgeSourceId: source.id,
          externalRef: `pasted:${randomUUID()}`,
          title: source.name,
          contentHash: createHash("sha256").update(reconstructed.text, "utf8").digest("hex"),
          byteSize: BigInt(documentBytes),
          mimeType: "text/plain",
          localeCode,
          storageRef: `sql:Chunks(sourceDocumentId)`,
          fetchedAt: input.now,
          supersedesDocumentId: liveDocumentId,
          now: input.now,
        },
        chunks: chunked.chunks.map((chunk) => ({
          knowledgeSourceId: source.id,
          knowledgeCollectionId: source.knowledgeCollectionId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          contentHash: chunk.contentHash,
          sectionPath: null,
          pageNumber: null,
          localeCode,
        })),
      });

      // The prior chunks are superseded by the new ones — erased rather than left live, so
      // indexedPercent/retrieval reflect only the current text.
      await this.deps.chunks.markErased(
        existingChunks.map((chunk) => chunk.id),
        input.now,
      );

      await this.deps.sources.completeIngestionRun({
        id: run.id,
        state: "Completed",
        documentsSeen: 1,
        documentsAdded: 0,
        documentsUpdated: 1,
        documentsRemoved: 0,
        chunksWritten: newChunks.length,
        chunksSkippedUnchanged: 0,
        error: null,
        finishedAt: input.now,
      });

      const refreshed = await this.deps.sources.getSource(source.id);
      return { ok: true, source: refreshed ?? source, chunksWritten: newChunks.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.sources.completeIngestionRun({
        id: run.id,
        state: "Failed",
        documentsSeen: 1,
        documentsAdded: 0,
        documentsUpdated: 0,
        documentsRemoved: 0,
        chunksWritten: 0,
        chunksSkippedUnchanged: 0,
        error: message,
        finishedAt: input.now,
      });
      throw error;
    }
  }
}
