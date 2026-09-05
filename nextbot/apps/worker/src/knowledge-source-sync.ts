import { syncDueSources } from "@nextbot/knowledge";

/** Target Architecture Blueprint Phase 7b (BL-38, LLD §14.4.3) — re-syncs a source
 *  whose `sync_interval_seconds` cadence is due. Runs every 60s (a sweep tick); each
 *  source's own interval governs whether it's actually due this tick. */
export async function runKnowledgeSourceSync(): Promise<ReturnType<typeof syncDueSources>> {
  return syncDueSources();
}
