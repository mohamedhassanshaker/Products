/**
 * Executes one `ReindexJob` end to end — B6 tab 3's job history (FR-KNOW-16). This is the
 * one place `domain/reindex-selection.ts`'s hard invariant actually matters operationally:
 * chunk selection is delegated to `selectChunksForReindex`, so a job with `reason =
 * 'EmbeddingModelChange'` is provably processing every in-scope chunk (see that module's
 * own `.test.ts` for the proof against fakes) rather than this file re-deriving "which
 * chunks need work" ad hoc and risking exactly the partial-reindex bug the invariant
 * guards against.
 *
 * Selected chunks are grouped by `(knowledgeCollectionId, knowledgeSourceId)` because
 * `KnowledgeAiClient.embedAndIndex` takes one collection/source pair per call — a `Tenant`-
 * scope job spanning several sources therefore makes several calls, one per group,
 * updating `progressPercent` after each so B6 tab 3 shows real, incremental progress
 * rather than a single jump from 0 to 100.
 */

import { applyEmbedAndIndexResult } from "./apply-embed-and-index-result.js";
import { selectChunksForReindex } from "../domain/reindex-selection.js";
import type { ChunkRepository, ChunkRow } from "../ports/chunk-repository.js";
import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type { ReindexJobRepository } from "../ports/reindex-job-repository.js";
import type { RetrievalConfigRepository } from "../ports/retrieval-config-repository.js";

export interface RunReindexJobInput {
  readonly jobId: string;
  readonly now: Date;
}

export type RunReindexJobResult =
  | { readonly ok: true; readonly chunksProcessed: number }
  | { readonly ok: false; readonly reason: "knowledge.job_not_found" }
  | { readonly ok: false; readonly reason: "knowledge.job_not_queued" }
  | { readonly ok: false; readonly reason: "knowledge.document_scope_not_supported" };

export interface RunReindexJobDeps {
  readonly reindexJobs: ReindexJobRepository;
  readonly chunks: ChunkRepository;
  readonly graph: GraphRepository;
  readonly retrievalConfig: RetrievalConfigRepository;
  readonly ai: KnowledgeAiClient;
}

function groupByCollectionAndSource(
  chunks: readonly ChunkRow[],
): ReadonlyMap<string, readonly ChunkRow[]> {
  const groups = new Map<string, ChunkRow[]>();
  for (const chunk of chunks) {
    const key = `${chunk.knowledgeCollectionId}::${chunk.knowledgeSourceId}`;
    const existing = groups.get(key);
    if (existing) existing.push(chunk);
    else groups.set(key, [chunk]);
  }
  return groups;
}

export class RunReindexJob {
  constructor(private readonly deps: RunReindexJobDeps) {}

  async execute(input: RunReindexJobInput): Promise<RunReindexJobResult> {
    const job = await this.deps.reindexJobs.get(input.jobId);
    if (!job) return { ok: false, reason: "knowledge.job_not_found" };
    if (job.state !== "Queued") return { ok: false, reason: "knowledge.job_not_queued" };

    if (job.scope === "Document") {
      // No `ReindexJobs` column identifies a single document (see this module's own doc
      // comment) and nothing in this wave ever creates a Document-scope job — refused
      // honestly rather than silently falling back to a different scope.
      await this.deps.reindexJobs.updateProgress({
        id: job.id,
        state: "Failed",
        progressPercent: 0,
        chunksTotal: null,
        chunksProcessed: 0,
        error: "Document-scope re-index is not supported this wave.",
        startedAt: input.now,
        finishedAt: input.now,
      });
      return { ok: false, reason: "knowledge.document_scope_not_supported" };
    }

    await this.deps.reindexJobs.updateProgress({
      id: job.id,
      state: "Running",
      progressPercent: 0,
      chunksTotal: null,
      chunksProcessed: 0,
      error: null,
      startedAt: input.now,
      finishedAt: null,
    });

    const allChunks = await this.deps.chunks.listAllChunks();
    const candidates =
      job.scope === "Tenant"
        ? allChunks
        : job.scope === "Collection"
          ? allChunks.filter((chunk) => chunk.knowledgeCollectionId === job.knowledgeCollectionId)
          : allChunks.filter((chunk) => chunk.knowledgeSourceId === job.knowledgeSourceId);

    const selected = selectChunksForReindex(job.reason, candidates);
    const total = selected.length;

    if (total === 0) {
      await this.deps.reindexJobs.updateProgress({
        id: job.id,
        state: "Completed",
        progressPercent: 100,
        chunksTotal: 0,
        chunksProcessed: 0,
        error: null,
        startedAt: input.now,
        finishedAt: input.now,
      });
      return { ok: true, chunksProcessed: 0 };
    }

    const config = await this.deps.retrievalConfig.ensureTenantConfig(input.now);
    const groups = groupByCollectionAndSource(selected);
    let processed = 0;

    try {
      for (const group of groups.values()) {
        const [firstChunk] = group;
        if (!firstChunk) continue; // groupByCollectionAndSource never creates an empty group; defensive only.
        const response = await this.deps.ai.embedAndIndex({
          knowledgeCollectionId: firstChunk.knowledgeCollectionId,
          knowledgeSourceId: firstChunk.knowledgeSourceId,
          embeddingModel: config.embeddingModel,
          embeddingDimension: config.embeddingDimension,
          chunks: group.map((chunk) => ({
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

        processed += group.length;
        await this.deps.reindexJobs.updateProgress({
          id: job.id,
          state: "Running",
          progressPercent: Math.floor((processed / total) * 100),
          chunksTotal: total,
          chunksProcessed: processed,
          error: null,
          startedAt: input.now,
          finishedAt: null,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.reindexJobs.updateProgress({
        id: job.id,
        state: "Failed",
        progressPercent: Math.floor((processed / total) * 100),
        chunksTotal: total,
        chunksProcessed: processed,
        error: message,
        startedAt: input.now,
        finishedAt: input.now,
      });
      throw error;
    }

    await this.deps.reindexJobs.updateProgress({
      id: job.id,
      state: "Completed",
      progressPercent: 100,
      chunksTotal: total,
      chunksProcessed: processed,
      error: null,
      startedAt: input.now,
      finishedAt: input.now,
    });

    return { ok: true, chunksProcessed: processed };
  }
}
