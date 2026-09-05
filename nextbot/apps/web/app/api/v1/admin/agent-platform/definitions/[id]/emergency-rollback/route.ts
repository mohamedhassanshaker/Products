import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { EmergencyRollbackRequestSchema } from "@nextbot/contracts";
import { handleEmergencyRollback } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/definitions/:id/emergency-rollback`
 * (FR-AGT-30, BL-27, ADR-0017). RBAC: `agent_platform=Write` — the **same** module/
 * level ordinary promotion already requires (ADR-0017 §2.2: "It is not given its own
 * privileged role: an actor who can promote can roll back"). Every eligibility check
 * (same agent definition, previously-Production-with-a-passing-gate, non-blank reason)
 * is enforced inside `handleEmergencyRollback` itself, never trusted from this route.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(EmergencyRollbackRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid emergency-rollback request.", status: 422 }, { status: 422 });
  }
  try {
    const result = await handleEmergencyRollback(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
