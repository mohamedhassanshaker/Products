import { syncAuditFromEventsAcrossAllTenants } from "@nextbot/audit";

/** Phase 17 (BL-10) — drains the `domain_event` outbox into `audit_log_entry` for
 * every active tenant. Scheduled every 30s (`scheduler.ts`). */
export async function runAuditSync(): Promise<{ tenantsChecked: number; synced: number }> {
  return syncAuditFromEventsAcrossAllTenants();
}
