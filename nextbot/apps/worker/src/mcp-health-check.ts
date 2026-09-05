import { probeAllConnectorsAcrossAllTenants } from "@nextbot/connectors";

/** Phase 18 (BL-11, FR-MCP-08) — probes every `StreamableHTTP` connector across
 * every active tenant, recording `connector_health_check` rows the MCP Health
 * admin surface reads. Scheduled every 60s (`scheduler.ts`), matching the
 * `health_interval_seconds` default most connectors are provisioned with. */
export async function runMcpHealthCheck(): Promise<{ tenantsChecked: number; probed: number }> {
  return probeAllConnectorsAcrossAllTenants();
}
