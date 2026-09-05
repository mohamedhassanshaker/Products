import type { TenantContext } from "@nextbot/db";
import { listActiveTenantContexts } from "@nextbot/tenancy";
import { computeManifestHash } from "../domain/manifest-hash.js";
import { classifyDrift, computeDriftDedupeKey } from "../domain/drift-classification.js";
import {
  listServersDueForReconciliation,
  listManifestItems,
  recordUnreachable,
  recordReconciledNoChange,
  insertDriftEventsAndMarkReconciled,
  getServerVersionManifestHash,
  type McpServerRow,
} from "../infrastructure/mcp-server-repository.js";
import { mcpClientManifestFetchPort, type ManifestFetchPort } from "./manifest-fetch-port.js";

export interface ReconcileServerResult {
  serverId: string;
  outcome: "Unreachable" | "NoChange" | "DriftDetected";
  driftEventsInserted: number;
}

/**
 * ADR-0014 §2.2's reconciler, for one server. Fetches the live manifest through
 * `port` (production: `mcpClientManifestFetchPort`, over `@nextbot/mcp-client` — the
 * Gateway-Plane-routed egress this ADR calls for is BL-34's addition once the
 * enrolment wizard's environment-binding model exists; this phase's server has a
 * single direct `endpointUrl`, see the schema file's scope-reduction note), recomputes
 * `manifest_hash`, and dispatches to exactly one of ADR-0014's three outcomes:
 *
 *   - Transport/reachability failure -> `recordUnreachable` (a health transition,
 *     **never** a drift event — FR-MCP-18's boundary rule).
 *   - `manifest_hash` unchanged -> `recordReconciledNoChange` (idempotent: zero rows
 *     written, zero alerts).
 *   - `manifest_hash` differs -> classify each per-tool difference
 *     (`classifyDrift`) and insert one drift event per classified change, each keyed
 *     by `computeDriftDedupeKey` so a re-run against the same live state inserts
 *     nothing new (the SQL-level partial-unique-index `ON CONFLICT DO NOTHING` is
 *     what actually enforces this, not this function's own logic).
 */
export async function reconcileServer(ctx: TenantContext, server: McpServerRow, port: ManifestFetchPort = mcpClientManifestFetchPort): Promise<ReconcileServerResult> {
  let liveTools;
  try {
    liveTools = await port.fetchLiveTools({ endpointUrl: server.endpointUrl, transport: server.transport });
  } catch (err) {
    await recordUnreachable(ctx, server.id, { code: "MCP_TRANSPORT_ERROR", message: err instanceof Error ? err.message : String(err) });
    return { serverId: server.id, outcome: "Unreachable", driftEventsInserted: 0 };
  }

  const liveManifestHash = computeManifestHash(liveTools.map((t) => ({ kind: "Tool", name: t.name, schemaHash: t.schemaHash })));

  // Re-read the pinned version's manifest hash fresh, rather than trusting a
  // possibly-stale `server.currentVersionId`'s hash carried across an `await` by the
  // caller — cheap, and closes a class of bug where the caller holds a stale row.
  const pinnedManifestHash = server.currentVersionId ? await getServerVersionManifestHash(ctx, server.currentVersionId) : null;

  if (liveManifestHash === pinnedManifestHash) {
    await recordReconciledNoChange(ctx, server.id);
    return { serverId: server.id, outcome: "NoChange", driftEventsInserted: 0 };
  }

  const pinnedItems = (await listManifestItems(ctx, server.currentVersionId as string)).filter((i) => i.kind === "Tool");
  const classifications = classifyDrift(
    pinnedItems.map((i) => ({ name: i.name, schemaHash: i.schemaHash })),
    liveTools.map((t) => ({ name: t.name, schemaHash: t.schemaHash })),
  );

  const events = classifications.map((c) => ({
    serverId: server.id,
    pinnedVersionId: server.currentVersionId as string,
    changeKind: c.changeKind,
    itemKind: "Tool" as const,
    itemName: c.itemName,
    oldSchemaHash: c.oldSchemaHash,
    newSchemaHash: c.newSchemaHash,
    dedupeKey: computeDriftDedupeKey({ pinnedVersionId: server.currentVersionId as string, changeKind: c.changeKind, itemKind: "Tool", itemName: c.itemName, newSchemaHash: c.newSchemaHash }),
  }));

  const inserted = await insertDriftEventsAndMarkReconciled(ctx, server.id, events);
  return { serverId: server.id, outcome: "DriftDetected", driftEventsInserted: inserted };
}

/** `reconcileDueServersForTenant`/`reconcileDueServersAcrossAllTenants` — mirrors
 * `audit`'s `syncAuditFromEventsForTenant`/`...AcrossAllTenants` convention exactly
 * (per-tenant `withTenant` transactions, driven by `apps/worker`'s scheduler). */
export async function reconcileDueServersForTenant(ctx: TenantContext, port: ManifestFetchPort = mcpClientManifestFetchPort): Promise<ReconcileServerResult[]> {
  const due = await listServersDueForReconciliation(ctx);
  const results: ReconcileServerResult[] = [];
  for (const server of due) {
    results.push(await reconcileServer(ctx, server, port));
  }
  return results;
}

export async function reconcileDueServersAcrossAllTenants(port: ManifestFetchPort = mcpClientManifestFetchPort): Promise<{ tenantsChecked: number; results: ReconcileServerResult[] }> {
  const tenants = await listActiveTenantContexts();
  const results: ReconcileServerResult[] = [];
  for (const tenantCtx of tenants) {
    results.push(...(await reconcileDueServersForTenant(tenantCtx, port)));
  }
  return { tenantsChecked: tenants.length, results };
}
