import { reclaimExpiredIngestionLeases } from "@nextbot/knowledge";

/** Target Architecture Blueprint Phase 7b (BL-38, LLD §14.4.3) — reclaims an
 *  ingestion job whose lease expired (its worker replica crashed mid-run) back to
 *  `Queued`. Runs every 60s, matching LLD's own named cadence. */
export async function runKnowledgeLeaseReaper(): Promise<ReturnType<typeof reclaimExpiredIngestionLeases>> {
  return reclaimExpiredIngestionLeases();
}
