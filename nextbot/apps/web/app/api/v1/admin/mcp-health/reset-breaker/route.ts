import { NextResponse, type NextRequest } from "next/server";
import { resetBreaker } from "@nextbot/mcp-client";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/mcp-health/reset-breaker` (RBAC: connectors=Write, B.3A.4's
 * "Reset" action) — an explicit operator action required by FR-MCP-08; the breaker
 * never auto-resets on its own besides the Open -> HalfOpen cooldown transition
 * (`@nextbot/mcp-client`'s own module doc). Wired to the real, Redis-backed,
 * cross-process breaker `apps/gateway`'s egress path actually trips — not a
 * separate display-only copy. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  const toolId = body?.toolId;
  if (!toolId || typeof toolId !== "string") {
    return NextResponse.json({ type: "about:blank", title: "toolId is required.", status: 422 }, { status: 422 });
  }

  try {
    await resetBreaker(guard.ctx.tenantId, toolId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
