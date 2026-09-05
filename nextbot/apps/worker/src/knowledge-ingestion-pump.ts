import { pumpIngestionJobs } from "@nextbot/knowledge";

/**
 * Target Architecture Blueprint Phase 7b (BL-38, LLD §14.4.3) — the 9-stage
 * knowledge ingestion pipeline's own scheduled pump, drained via `FOR UPDATE SKIP
 * LOCKED` leases from the `knowledge_ingestion_job` Postgres work table. Runs every
 * 5s (LLD's own named cadence for `knowledgeIngestionPumpJob`). Disclosed: this
 * phase runs the pipeline inside `apps/worker` rather than a new `apps/ingest`
 * deployable — see `packages/modules/knowledge/README.md`.
 */
export async function runKnowledgeIngestionPump(): Promise<ReturnType<typeof pumpIngestionJobs>> {
  return pumpIngestionJobs({ maxConcurrentPerTenant: 4, leaseSeconds: 300 });
}
