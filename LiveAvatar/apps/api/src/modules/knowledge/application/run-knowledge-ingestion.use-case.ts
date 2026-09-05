import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolveChunker } from '../domain/chunking/chunker-registry';
import type { KnowledgeSourceRecord } from '../domain/knowledge-source';
import {
  EMBEDDING_CLIENT,
  KNOWLEDGE_CHUNK_REPOSITORY,
  KNOWLEDGE_SOURCE_REPOSITORY,
  type EmbeddingClientPort,
  type KnowledgeChunkRepositoryPort,
  type KnowledgeSourceRepositoryPort,
  type UpdateKnowledgeSourceInput,
} from '../domain/ports';
import { cleanText, parseContent } from '../domain/parsing/parse-content';
import { assertChunkingStrategySupported, assertParserSupported } from '../domain/validation';

/** Matches the Python `/embed` endpoint's documented `inputs` cap (max 96 per call). */
const EMBEDDING_BATCH_SIZE = 96;

/** DB column width for `KnowledgeSource.errorMessage` (`@db.VarChar(500)`). */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * `KnowledgeSource` -> parse -> chunk -> persist -> embed -> index pipeline
 * (Phase 12a, BL-044/046). Invoked only by `KnowledgeIngestProcessor`
 * (`apps/api/src/modules/jobs/infrastructure/knowledge-ingest.processor.ts`)
 * — never called directly from an HTTP route.
 */
@Injectable()
export class RunKnowledgeIngestionUseCase {
  private readonly logger = new Logger(RunKnowledgeIngestionUseCase.name);

  constructor(
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly sources: KnowledgeSourceRepositoryPort,
    @Inject(KNOWLEDGE_CHUNK_REPOSITORY) private readonly chunks: KnowledgeChunkRepositoryPort,
    @Inject(EMBEDDING_CLIENT) private readonly embeddingClient: EmbeddingClientPort,
  ) {}

  /**
   * @param tenantId - Owning tenant
   * @param sourceId - `KnowledgeSource` to (re-)index
   */
  async execute(tenantId: string, sourceId: string): Promise<void> {
    const source = await this.sources.findById(tenantId, sourceId);
    if (!source) {
      this.logger.warn({ tenantId, sourceId }, 'knowledge source not found; skipping ingestion (deleted mid-flight)');
      return;
    }

    let active = await this.markProcessing(tenantId, sourceId, source);
    if (!active) {
      // Source disappeared between the initial load and the status flip.
      return;
    }

    try {
      // Defensive re-validation (step 3): config could in principle be
      // edited to an unsupported value between save-time validation and
      // processing, or a future migration bug — catch that here too, same
      // discipline Phase 11's guard fields used.
      assertParserSupported(active.parser);
      assertChunkingStrategySupported(active.chunkingStrategy);

      const text = cleanText(parseContent(active.rawContent, active.parser));
      const chunkResults = resolveChunker(active.chunkingStrategy).chunk(text, {
        chunkSize: active.chunkSize,
        chunkOverlap: active.chunkOverlap,
      });

      if (chunkResults.length === 0) {
        // A legitimate terminal outcome, not a retryable error — no throw.
        await this.sources.update(tenantId, sourceId, active.updatedAt, {
          status: 'failed',
          errorMessage: 'Source produced no content to index.',
        });
        return;
      }

      const persistedChunks = await this.chunks.replaceForSource(
        tenantId,
        sourceId,
        chunkResults.map((c) => ({
          chunkIndex: c.index,
          text: c.text,
          // Rough char/4 heuristic — no real tokenizer dependency needed this phase.
          tokenCount: Math.ceil(c.text.length / 4),
        })),
      );

      active = await this.applyUpdate(tenantId, sourceId, active, { chunkCount: persistedChunks.length });

      const embeddingItems: { chunkId: string; embedding: number[] }[] = [];
      for (let i = 0; i < persistedChunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = persistedChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const { embeddings } = await this.embeddingClient.embed({
          provider: 'openai',
          model: active.embeddingModel,
          credentialRef: active.embeddingCredentialRef,
          inputs: batch.map((c) => c.text),
        });
        batch.forEach((chunk, idx) => {
          embeddingItems.push({ chunkId: chunk.id, embedding: embeddings[idx] });
        });
      }

      await this.chunks.writeEmbeddings(tenantId, sourceId, embeddingItems);

      await this.sources.update(tenantId, sourceId, active.updatedAt, {
        status: 'ready',
        lastIndexedAt: new Date(),
      });
    } catch (err) {
      // A safe, short message only — never a raw vendor response body or
      // anything that could contain a credential.
      const rawMessage = err instanceof Error ? err.message : 'Ingestion failed.';
      const errorMessage = rawMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH);
      await this.sources.update(tenantId, sourceId, active.updatedAt, { status: 'failed', errorMessage });
      // Rethrow so BullMQ records the job attempt as failed (bounded retries
      // are configured at the queue.add()/job-options level, not here).
      throw err;
    }
  }

  /**
   * Flips the source to `processing`, clearing any previous error. A
   * `'conflict'`/`'missing'` result (a benign concurrent edit) does not
   * hard-fail the pipeline — this step only exists to visibly reflect
   * status, not to gate the rest of the run — so this re-fetches the
   * current row and continues with its config either way.
   * @returns The row to run the pipeline against, or `null` if the source
   *          was deleted between the initial load and this flip.
   */
  private async markProcessing(
    tenantId: string,
    sourceId: string,
    loaded: KnowledgeSourceRecord,
  ): Promise<KnowledgeSourceRecord | null> {
    const marked = await this.sources.update(tenantId, sourceId, loaded.updatedAt, {
      status: 'processing',
      errorMessage: null,
    });
    if (marked !== 'conflict' && marked !== 'missing') {
      return marked;
    }
    this.logger.warn(
      { tenantId, sourceId, result: marked },
      'could not flip knowledge source to processing (benign concurrent edit); continuing with the freshly loaded row',
    );
    const refetched = await this.sources.findById(tenantId, sourceId);
    if (!refetched) {
      this.logger.warn(
        { tenantId, sourceId },
        'knowledge source disappeared after a concurrent-edit conflict; skipping ingestion',
      );
      return null;
    }
    return refetched;
  }

  /**
   * Applies an intermediate patch and returns the fresh row (so the next
   * optimistic-concurrency call uses an up-to-date `ifMatch`). Falls back to
   * `current` on a benign `'conflict'`/`'missing'` — same best-effort spirit
   * as `markProcessing`, since a mid-pipeline status/count write is not
   * itself worth aborting the whole run over.
   */
  private async applyUpdate(
    tenantId: string,
    sourceId: string,
    current: KnowledgeSourceRecord,
    patch: UpdateKnowledgeSourceInput,
  ): Promise<KnowledgeSourceRecord> {
    const result = await this.sources.update(tenantId, sourceId, current.updatedAt, patch);
    return result === 'conflict' || result === 'missing' ? current : result;
  }
}
