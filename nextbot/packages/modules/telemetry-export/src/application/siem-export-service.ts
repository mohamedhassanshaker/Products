import type { TenantContext } from "@nextbot/db";
import { listActiveTenantContexts } from "@nextbot/tenancy";
import { getSiemExportConfig } from "../infrastructure/siem-export-config-repository.js";
import { advanceSiemExportCursor } from "../infrastructure/siem-export-config-repository.js";
import { listAuditLogEntriesSince } from "../infrastructure/audit-log-reader.js";

const BATCH_SIZE = 200;

/**
 * FR-ADM-10's audit-log SIEM streaming, for one tenant: reads a batch of
 * `audit_log_entry` rows after this config's OWN cursor
 * (`last_exported_audit_log_id`, never `domain_event.processed`/`processed_at` —
 * see `siem_export_config`'s schema-file doc comment), batch-POSTs them as a JSON
 * lines body, and only advances the cursor once the POST genuinely succeeded — a
 * failed batch is retried on the NEXT sweep tick from the SAME (unmoved) cursor, so a
 * transient SIEM-endpoint outage can never silently drop a batch. Additive to (never
 * a replacement for) the in-console Audit Log Viewer, which keeps reading
 * `audit_log_entry` directly and is entirely unaffected by whether this export is
 * enabled.
 */
export async function exportSiemBatchForTenant(ctx: TenantContext, fetchImpl: typeof fetch = fetch): Promise<{ exported: number }> {
  const config = await getSiemExportConfig(ctx);
  if (!config || !config.enabled) return { exported: 0 };

  const batch = await listAuditLogEntriesSince(ctx, config.lastExportedAuditLogId, BATCH_SIZE);
  if (batch.length === 0) return { exported: 0 };

  const body = batch.map((row) => JSON.stringify({ ...row, occurredAt: row.occurredAt.toISOString() })).join("\n");
  const response = await fetchImpl(config.endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body,
  });
  if (!response.ok) {
    // Fail safe, never throw into the worker sweep's own cross-tenant loop — one
    // tenant's SIEM endpoint being down must never stop every other tenant's export.
    console.error(`NextBot: SIEM export POST for tenant ${ctx.tenantId} failed with status ${response.status}`);
    return { exported: 0 };
  }

  const last = batch[batch.length - 1];
  if (last) await advanceSiemExportCursor(ctx, config.id, last.id);
  return { exported: batch.length };
}

export async function exportSiemBatchAcrossAllTenants(fetchImpl: typeof fetch = fetch): Promise<{ tenantsChecked: number; exported: number }> {
  const tenants = await listActiveTenantContexts();
  let exported = 0;
  for (const ctx of tenants) {
    const result = await exportSiemBatchForTenant(ctx, fetchImpl);
    exported += result.exported;
  }
  return { tenantsChecked: tenants.length, exported };
}
