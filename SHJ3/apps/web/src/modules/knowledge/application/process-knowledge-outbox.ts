/**
 * Claims a batch of `Pending`/`Failed` `OutboxEvent` rows and applies each by calling the
 * AI service's `embed-and-index` endpoint — §9.2 steps 3-6. Real orchestration, not a
 * stub: this is what actually turns a `Pending` `Chunk` into an `Indexed` one.
 *
 * Only `aggregateKind: 'Chunk'` events exist in this wave (the only kind
 * `ChunkRepository.createDocumentWithChunks` ever enqueues) — a future wave adding
 * `SourceDocument`/`GraphNodeRecord`/`GraphEdgeRecord`/`KnowledgeSource` outbox producers
 * will need a second branch here, not a rewrite of this one.
 *
 * Called two ways, both real (see this wave's own scope note in the top-level brief): (1)
 * synchronously, inline, right after `add-source`/`trigger-reindex-source` Server Actions,
 * so a demo does not depend on a background loop being up; (2) from `scripts/process-
 * knowledge-outbox.ts`'s polling loop, standing in for the `shj3-worker` deployment named
 * in `docs/architecture.md` (no separate worker deployable exists yet in this repo).
 */

import { applyEmbedAndIndexResult } from "./apply-embed-and-index-result.js";
import { nextAvailableAt, outboxRowBecomesDead } from "../domain/outbox-backoff.js";
import type { ChunkRepository } from "../ports/chunk-repository.js";
import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type { OutboxEventRow, OutboxRepository } from "../ports/outbox-repository.js";
import type { RetrievalConfigRepository } from "../ports/retrieval-config-repository.js";

export interface ProcessKnowledgeOutboxInput {
  readonly batchSize: number;
  readonly workerId: string;
  readonly now: Date;
}

export interface ProcessKnowledgeOutboxResult {
  readonly claimed: number;
  readonly applied: number;
  readonly failed: number;
}

export interface ProcessKnowledgeOutboxDeps {
  readonly outbox: OutboxRepository;
  readonly chunks: ChunkRepository;
  readonly graph: GraphRepository;
  readonly retrievalConfig: RetrievalConfigRepository;
  readonly ai: KnowledgeAiClient;
}

interface ChunkEventPayload {
  readonly knowledgeSourceId: string;
  readonly knowledgeCollectionId: string;
}

function parsePayload(event: OutboxEventRow): ChunkEventPayload {
  const parsed = JSON.parse(event.payloadJson) as Partial<ChunkEventPayload>;
  if (!parsed.knowledgeSourceId || !parsed.knowledgeCollectionId) {
    throw new Error(
      `OutboxEvent ${event.id} has a malformed Chunk payload: "${event.payloadJson}".`,
    );
  }
  return {
    knowledgeSourceId: parsed.knowledgeSourceId,
    knowledgeCollectionId: parsed.knowledgeCollectionId,
  };
}

function groupKey(payload: ChunkEventPayload): string {
  return `${payload.knowledgeCollectionId}::${payload.knowledgeSourceId}`;
}

export class ProcessKnowledgeOutbox {
  constructor(private readonly deps: ProcessKnowledgeOutboxDeps) {}

  async execute(input: ProcessKnowledgeOutboxInput): Promise<ProcessKnowledgeOutboxResult> {
    const claimed = await this.deps.outbox.claimBatch(input.batchSize, input.workerId, input.now);
    if (claimed.length === 0) return { claimed: 0, applied: 0, failed: 0 };

    const chunkEvents = claimed.filter((event) => event.aggregateKind === "Chunk");
    const groups = new Map<
      string,
      { readonly payload: ChunkEventPayload; readonly events: OutboxEventRow[] }
    >();
    for (const event of chunkEvents) {
      const payload = parsePayload(event);
      const key = groupKey(payload);
      const existing = groups.get(key);
      if (existing) existing.events.push(event);
      else groups.set(key, { payload, events: [event] });
    }

    const config = await this.deps.retrievalConfig.ensureTenantConfig(input.now);
    let applied = 0;
    let failed = 0;

    for (const { payload, events } of groups.values()) {
      const chunkIds = events.map((event) => event.aggregateId);
      const chunkRows = await this.deps.chunks.listChunksByIds(chunkIds);

      try {
        const response = await this.deps.ai.embedAndIndex({
          knowledgeCollectionId: payload.knowledgeCollectionId,
          knowledgeSourceId: payload.knowledgeSourceId,
          embeddingModel: config.embeddingModel,
          embeddingDimension: config.embeddingDimension,
          chunks: chunkRows.map((chunk) => ({
            chunkId: chunk.id,
            text: chunk.text,
            ordinal: chunk.ordinal,
            sectionPath: chunk.sectionPath,
            pageNumber: chunk.pageNumber,
            localeCode: chunk.localeCode,
          })),
        });

        await applyEmbedAndIndexResult(
          { chunks: this.deps.chunks, graph: this.deps.graph },
          {
            response,
            embeddingModel: config.embeddingModel,
            embeddingDimension: config.embeddingDimension,
            now: input.now,
          },
        );

        const resultByChunkId = new Map(
          response.results.map((result) => [result.chunkId, result] as const),
        );
        for (const event of events) {
          const result = resultByChunkId.get(event.aggregateId);
          const succeeded = result?.vectorState === "Indexed" && result.graphState === "Indexed";
          if (succeeded) {
            await this.deps.outbox.markApplied(event.id, input.now);
            applied += 1;
          } else {
            await this.deps.outbox.markFailed({
              id: event.id,
              error:
                result?.error ??
                `Chunk ${event.aggregateId} was not present in the embed-and-index response.`,
              nextAvailableAt: nextAvailableAt(input.now, event.attemptCount),
              becameDead: outboxRowBecomesDead(event.attemptCount, event.maxAttempts),
            });
            failed += 1;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const event of events) {
          await this.deps.outbox.markFailed({
            id: event.id,
            error: message,
            nextAvailableAt: nextAvailableAt(input.now, event.attemptCount),
            becameDead: outboxRowBecomesDead(event.attemptCount, event.maxAttempts),
          });
          failed += 1;
        }
      }
    }

    return { claimed: claimed.length, applied, failed };
  }
}
