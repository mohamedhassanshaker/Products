import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ReassignEscalationRequestSchema } from "@nextbot/contracts";
import { reassignEscalation } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/escalations/{id}/reassign` (RBAC: escalations=Write) — B.5.1's
 * "Reassign" action (to a different queue and/or agent). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(ReassignEscalationRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid reassign request.", status: 422 }, { status: 422 });
  }

  try {
    const escalation = await reassignEscalation(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json({ id: escalation.id, queueId: escalation.queueId, status: escalation.status });
  } catch (err) {
    return problemResponse(err);
  }
}
