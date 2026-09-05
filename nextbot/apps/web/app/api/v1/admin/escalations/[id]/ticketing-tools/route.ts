import { NextResponse } from "next/server";
import { listConnectors } from "@nextbot/connectors";
import { listCatalog } from "@nextbot/tool-registry";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/escalations/{id}/ticketing-tools` (RBAC: escalations=Read) —
 * QA fix D2: backs the Live Takeover Panel's "Create Case" action. Lists the
 * agent-visible tools exposed by any `Ticketing`-backend-type connector, so the panel
 * can pre-fill a manual tool trigger (reusing BE1's now-tier-aware
 * `.../tool-calls` machinery) against whatever ticketing tool the Agent Tool
 * Registry has discovered, instead of hardcoding a specific connector/tool.
 *
 * Deliberately gated on `escalations=Read` (not `tool_permissions`, which the
 * catalog's own admin screen uses) — a human agent with only Escalation access
 * still needs to see which ticketing tool(s) exist to trigger "Create Case"; the
 * actual invocation still goes through `.../tool-calls`, which independently
 * enforces `approval_queue=Write` for any tool that resolves above Tier-1.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;
  await params; // path param unused beyond RBAC/route shape — no escalation-specific filtering needed for a tenant-scoped catalog lookup.

  const connectors = await listConnectors(guard.ctx);
  const ticketingConnectorIds = connectors.filter((c) => c.backendType === "Ticketing").map((c) => c.id);

  const tools = (
    await Promise.all(ticketingConnectorIds.map((connectorId) => listCatalog(guard.ctx, { connectorId })))
  )
    .flat()
    .filter((t) => t.visibleToAgent && t.status === "Active");

  return NextResponse.json({
    tools: tools.map((t) => ({ id: t.id, name: t.name, displayName: t.displayName ?? t.name, connectorId: t.connectorId })),
  });
}
