/**
 * Add a knowledge source — B6 tab 1's **+ Add source** (FR-KNOW-02).
 *
 * **`Document` is the one source type this wave wires end to end.** For it, the pasted/
 * uploaded text is chunked for real (via `KnowledgeAiClient.chunkDocument`) and written
 * through §9.2's write-ordering invariant (`ChunkRepository.createDocumentWithChunks`'s own
 * single transaction). The other four types (`UrlCrawler`, `Database`, `SharePoint`,
 * `ApiFeed`) are real, persisted, schedulable rows — they begin at 0% indexed and stay
 * there, because this wave does not build their actual fetch mechanics. That is a
 * deliberate scope boundary, not a bug: say so plainly in the UI (`sources-tab.tsx`'s own
 * comment) and in this wave's final report, never silently.
 */

import { createHash, randomUUID } from "node:crypto";
import { FULLY_WIRED_SOURCE_TYPE } from "../domain/knowledge-catalog.js";
import type { ChunkRepository } from "../ports/chunk-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type {
  KnowledgeSourceRepository,
  KnowledgeSourceRow,
} from "../ports/knowledge-source-repository.js";
import type { RetrievalConfigRepository } from "../ports/retrieval-config-repository.js";
import type { SourceSchedule, SourceType } from "../domain/knowledge-catalog.js";

export interface AddSourceInput {
  readonly name: string;
  readonly sourceType: SourceType;
  readonly location: string;
  readonly schedule: SourceSchedule;
  readonly credentialSecretRef: string | null;
  /** Required, non-empty, only when `sourceType === 'Document'`. */
  readonly documentText: string | null;
  readonly localeCode: string;
  readonly ranByStaffUserId: string;
  readonly now: Date;
}

export interface AddSourceResult {
  readonly source: KnowledgeSourceRow;
  readonly chunksWritten: number;
}

export interface AddSourceDeps {
  readonly sources: KnowledgeSourceRepository;
  readonly chunks: ChunkRepository;
  readonly retrievalConfig: RetrievalConfigRepository;
  readonly ai: KnowledgeAiClient;
}

export class AddSource {
  constructor(private readonly deps: AddSourceDeps) {}

  async execute(input: AddSourceInput): Promise<AddSourceResult> {
    const collection = await this.deps.sources.ensureDefaultCollection(input.now);
    const source = await this.deps.sources.createSource({
      knowledgeCollectionId: collection.id,
      name: input.name,
      sourceType: input.sourceType,
      location: input.location,
      schedule: input.schedule,
      credentialSecretRef: input.credentialSecretRef,
      now: input.now,
    });

    if (input.sourceType !== FULLY_WIRED_SOURCE_TYPE) {
      // Real, persisted, schedulable — but no fetch mechanics this wave. Left at 0% indexed
      // rather than faking progress (§9.4's own rule: a progress bar that lies is worse than
      // none).
      return { source, chunksWritten: 0 };
    }

    const documentText = input.documentText?.trim();
    if (!documentText) {
      throw new Error('A "Document" source requires non-empty pasted/uploaded text.');
    }

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
        documentText,
        chunkSizeTokens: config.chunkSizeTokens,
        chunkOverlapTokens: config.chunkOverlapTokens,
        localeCode: input.localeCode,
      });

      const documentBytes = Buffer.byteLength(documentText, "utf8");
      const { chunks } = await this.deps.chunks.createDocumentWithChunks({
        document: {
          knowledgeSourceId: source.id,
          externalRef: `pasted:${randomUUID()}`,
          title: input.name,
          contentHash: createHash("sha256").update(documentText, "utf8").digest("hex"),
          byteSize: BigInt(documentBytes),
          mimeType: "text/plain",
          localeCode: input.localeCode,
          storageRef: `sql:Chunks(sourceDocumentId)`,
          fetchedAt: input.now,
          supersedesDocumentId: null,
          now: input.now,
        },
        chunks: chunked.chunks.map((chunk) => ({
          knowledgeSourceId: source.id,
          knowledgeCollectionId: collection.id,
          ordinal: chunk.ordinal,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          contentHash: chunk.contentHash,
          sectionPath: null,
          pageNumber: null,
          localeCode: input.localeCode,
        })),
      });

      await this.deps.sources.completeIngestionRun({
        id: run.id,
        state: "Completed",
        documentsSeen: 1,
        documentsAdded: 1,
        documentsUpdated: 0,
        documentsRemoved: 0,
        chunksWritten: chunks.length,
        chunksSkippedUnchanged: 0,
        error: null,
        finishedAt: input.now,
      });

      const refreshed = await this.deps.sources.getSource(source.id);
      return { source: refreshed ?? source, chunksWritten: chunks.length };
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
