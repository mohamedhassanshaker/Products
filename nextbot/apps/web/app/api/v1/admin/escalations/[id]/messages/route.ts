import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SendHumanAgentMessageRequestSchema } from "@nextbot/contracts";
import { sendHumanAgentMessage } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/escalations/{id}/messages` (RBAC: escalations=Write) — FR-ESC-02:
 * the human agent's own message, sent directly from the Live Takeover Panel. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SendHumanAgentMessageRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid message request.", status: 422 }, { status: 422 });
  }

  try {
    await sendHumanAgentMessage(guard.ctx, id, guard.session.userId, body.payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
