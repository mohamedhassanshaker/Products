import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { McpDriftReviewRequestSchema } from "@nextbot/contracts";
import { handleReviewDrift } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `POST /api/v1/admin/mcp/servers/{id}/drift/review` — Accept/Reject pending drift
 * (FR-MCP-18, RBAC: connectors=Write). Accepting mints a new immutable server
 * version (Phase 0's `reviewDrift`, unchanged this phase); rejecting mints nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(McpDriftReviewRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid drift review payload.", status: 422 }, { status: 422 });
  }

  try {
    const result = await handleReviewDrift(guard.ctx, id, body.decisions, guard.session.userId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "mcp_server.drift_review",
      targetType: "McpServer",
      targetId: id,
      outcome: "Success",
      details: { accepted: result.accepted, rejected: result.rejected, newServerVersionId: result.newServerVersionId },
    });
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
