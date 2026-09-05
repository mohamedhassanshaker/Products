import { sweepKnowledgeRetention } from "@nextbot/knowledge";

/** Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — purges any
 *  knowledge source whose collection has an explicit, aged-past `retention_days`
 *  configured. Runs hourly, mirroring `tenancy.retention-purge`'s own cadence
 *  reasoning (idempotent over-approximation — it only ever deletes rows already
 *  past their cutoff). */
export async function runKnowledgeRetentionPurge(): Promise<ReturnType<typeof sweepKnowledgeRetention>> {
  return sweepKnowledgeRetention();
}
