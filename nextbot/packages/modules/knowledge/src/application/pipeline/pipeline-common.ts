import type { TenantContext } from "@nextbot/db";
import { completeJob, listJobsForGeneration, type KnowledgeIngestionJobRow, enqueueJob, type EnqueueJobInput } from "../../infrastructure/ingestion-job-repository.js";

/** Every collection-wide stage (Resolve onward) is ONE job per generation this
 *  phase (a disclosed, documented simplification of LLD §14.4.3's literal
 *  per-stale-community/per-stale-entity granularity for `CommunitySummaries` and
 *  the entity/community-embedding half of `Embed` — `knowledge_ingestion_job` has
 *  no `community_id` column, and its idempotency key
 *  `(tenant, generation, stage, coalesce(document_id, source_id, generation_id))`
 *  would collapse multiple same-generation, no-document/source rows onto ONE key
 *  anyway. The OBSERVABLE behavior LLD asks for — only stale items regenerate, one
 *  item's failure never blocks the rest — is preserved via an internal per-item
 *  try/catch loop inside each stage's own handler, just not via separate job rows.
 *  Ingest (per source), Parse/Chunk/ExtractEntities (per document) DO get real,
 *  separate job rows — those stages have a real schema column to key on. */
export const COLLECTION_WIDE_STAGES = ["Resolve", "BuildGraph", "CommunityDetection", "CommunitySummaries", "Embed", "Index"] as const;

/** Marks a job Succeeded, per this module's convention every stage handler ends
 *  with on its own happy path (kept as a one-line re-export so stage files don't
 *  each need their own import of `completeJob` alongside the repository they use
 *  for their real work). */
export { completeJob };

/**
 * Checks whether every job belonging to the given prior stages has reached a
 * terminal status (`Succeeded`/`Failed`/`Skipped`/`Cancelled`) for this generation
 * — the fan-in gate a collection-wide stage (Resolve onward) waits on before its
 * one job is enqueued. Requires each prior stage to have at least one job (a stage
 * that never got a chance to enqueue anything yet must not be treated as
 * "complete" by vacuous truth) UNLESS `allowEmpty` explicitly permits it — a
 * collection with a source that produced zero documents legitimately has zero
 * Parse/Chunk/ExtractEntities jobs, and FR-KB-02's own "a collection with zero
 * sources/documents is valid" boundary must still let a generation reach Ready.
 */
export async function areAllPriorStagesComplete(
  ctx: TenantContext,
  generationId: string,
  priorStages: readonly KnowledgeIngestionJobRow["stage"][],
  opts: { requireAtLeastOneIngestJob: boolean },
): Promise<boolean> {
  const jobs = await listJobsForGeneration(ctx, generationId);
  const ingestJobs = jobs.filter((j) => j.stage === "Ingest");
  if (opts.requireAtLeastOneIngestJob && ingestJobs.length === 0) return false;
  if (ingestJobs.some((j) => j.status === "Queued" || j.status === "Leased")) return false;

  for (const stage of priorStages) {
    const stageJobs = jobs.filter((j) => j.stage === stage);
    if (stageJobs.some((j) => j.status === "Queued" || j.status === "Leased")) return false;
  }
  return true;
}

/** Idempotent — enqueuing a collection-wide stage's job a second time (e.g. two
 *  concurrent "last finisher" callers both observing completion) is a safe no-op,
 *  `enqueueJob` itself swallows the duplicate-key race. */
export async function advanceToStage(ctx: TenantContext, input: EnqueueJobInput): Promise<void> {
  await enqueueJob(ctx, input);
}
