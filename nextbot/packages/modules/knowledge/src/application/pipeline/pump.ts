import { listActiveTenantContexts } from "@nextbot/tenancy";
import { claimDueJobs, reclaimExpiredLeases, type KnowledgeIngestionJobRow } from "../../infrastructure/ingestion-job-repository.js";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import { getGenerationOrThrow } from "../../infrastructure/generation-repository.js";
import { runIngestStage, runParseStage, runChunkStage } from "./stage-ingest-parse-chunk.js";
import { runExtractEntitiesStage, runResolveStage, runBuildGraphStage } from "./stage-extract-resolve-buildgraph.js";
import { runCommunityDetectionStage, runCommunitySummariesStage, runEmbedStage, runIndexStage } from "./stage-community-embed-index.js";
import type { TenantContext } from "@nextbot/db";

/**
 * `apps/worker`'s dispatcher for the 9-stage ingestion pipeline (LLD §14.4.3's
 * `knowledgeIngestionPumpJob`). Deliberately NOT a new `apps/ingest` deployable this
 * phase (a disclosed narrowing — see this module's README) — the pipeline runs
 * inside `apps/worker`'s existing scheduler, reusing its `ScheduledJob` contract
 * verbatim, the same idiom every other `apps/worker` job already follows.
 */
async function dispatchStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  switch (job.stage) {
    case "Ingest":
      return runIngestStage(ctx, job);
    case "Parse":
      return runParseStage(ctx, job);
    case "Chunk": {
      const generation = await getGenerationOrThrow(ctx, job.generationId);
      const collection = await getCollectionOrThrow(ctx, generation.collectionId);
      return runChunkStage(ctx, job, collection.chunkingConfig);
    }
    case "ExtractEntities":
      return runExtractEntitiesStage(ctx, job);
    case "Resolve":
      return runResolveStage(ctx, job);
    case "BuildGraph":
      return runBuildGraphStage(ctx, job);
    case "CommunityDetection":
      return runCommunityDetectionStage(ctx, job);
    case "CommunitySummaries":
      return runCommunitySummariesStage(ctx, job);
    case "Embed":
      return runEmbedStage(ctx, job);
    case "Index":
      return runIndexStage(ctx, job);
    default: {
      const exhaustive: never = job.stage;
      throw new Error(`pumpIngestionJobs: unknown stage ${String(exhaustive)}`);
    }
  }
}

export interface PumpResult {
  tenantsChecked: number;
  claimed: number;
}

/**
 * Claims and runs due jobs across every active tenant (`FOR UPDATE SKIP LOCKED`,
 * per-tenant so `withTenant`'s RLS holds for every claim/update — LLD §14.4.3's own
 * instruction). Each job's own failure is caught inside its stage handler (never
 * propagated here) — one job failing must never stop the pump from processing the
 * rest, the same contract every `apps/worker` job already has.
 */
export async function pumpIngestionJobs(opts: { maxConcurrentPerTenant?: number; leaseSeconds?: number } = {}): Promise<PumpResult> {
  const maxConcurrentPerTenant = opts.maxConcurrentPerTenant ?? 4;
  const leaseSeconds = opts.leaseSeconds ?? 300;
  const leaseOwner = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  const tenants = await listActiveTenantContexts();
  let claimed = 0;
  for (const ctx of tenants) {
    const jobs = await claimDueJobs(ctx, maxConcurrentPerTenant, leaseOwner, leaseSeconds);
    claimed += jobs.length;
    for (const job of jobs) {
      await dispatchStage(ctx, job);
    }
  }
  return { tenantsChecked: tenants.length, claimed };
}

/** `knowledge.lease-reaper` (LLD §14.4.3) — reclaims a job whose lease expired
 *  (e.g. the worker replica that leased it crashed mid-run) back to `Queued`. */
export async function reclaimExpiredIngestionLeases(): Promise<{ tenantsChecked: number; reclaimed: number }> {
  const tenants = await listActiveTenantContexts();
  let reclaimed = 0;
  for (const ctx of tenants) {
    reclaimed += await reclaimExpiredLeases(ctx);
  }
  return { tenantsChecked: tenants.length, reclaimed };
}
