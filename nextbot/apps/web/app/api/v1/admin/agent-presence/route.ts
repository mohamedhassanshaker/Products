import { NextResponse } from "next/server";
import { listAgentPresenceForTenant } from "@nextbot/escalations";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/agent-presence` (RBAC: escalations=Read) — Target Architecture
 * Blueprint Phase 13 (BL-45, FR-ESC-05). The tenant-wide presence overview (every
 * agent's current `state`/`maxConcurrent`/`currentLoad`) — a small admin surface, not
 * a full workforce-management screen.
 */
export async function GET() {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;
  const rows = await listAgentPresenceForTenant(guard.ctx);
  return NextResponse.json({ agents: rows });
}
