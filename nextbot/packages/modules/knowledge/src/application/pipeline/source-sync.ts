import { listActiveTenantContexts } from "@nextbot/tenancy";
import { listSourcesDueForSync } from "../../infrastructure/source-repository.js";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import { getCurrentReadyGenerationForCollection } from "../../infrastructure/generation-repository.js";
import { enqueueJob } from "../../infrastructure/ingestion-job-repository.js";

/**
 * `knowledge.source-sync` (LLD §14.4.3) — re-enqueues an `Ingest` job for every
 * source whose `sync_interval_seconds` cadence is due. Only re-syncs into the
 * collection's CURRENT Ready generation (never a superseded one — FR-KB-03: an old
 * generation stays queryable but frozen); a collection with no Ready generation yet
 * (still Building, or never built) is skipped this tick rather than erroring — a
 * legitimate transient state, not a failure.
 */
export async function syncDueSources(): Promise<{ tenantsChecked: number; enqueued: number }> {
  const tenants = await listActiveTenantContexts();
  let enqueued = 0;
  for (const ctx of tenants) {
    const dueSources = await listSourcesDueForSync(ctx);
    for (const source of dueSources) {
      const collection = await getCollectionOrThrow(ctx, source.collectionId);
      const generation = collection.currentGenerationId ? await getCurrentReadyGenerationForCollection(ctx, collection.id) : null;
      if (!generation) continue;
      const job = await enqueueJob(ctx, { generationId: generation.id, sourceId: source.id, stage: "Ingest", input: {} });
      if (job) enqueued += 1;
    }
  }
  return { tenantsChecked: tenants.length, enqueued };
}
