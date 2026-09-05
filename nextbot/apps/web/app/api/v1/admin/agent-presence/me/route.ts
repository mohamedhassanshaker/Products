import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetAgentPresenceStateRequestSchema } from "@nextbot/contracts";
import { getOrCreateAgentPresence, setMyPresenceState } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET/PATCH /api/v1/admin/agent-presence/me` (RBAC: escalations Read/Write) —
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05). The self-service
 * presence status toggle: `userId` always comes from the acting session
 * (`guard.session.userId`), never from client-supplied input — an agent can only
 * ever read/set their OWN presence through this route (setting `maxConcurrent` is
 * a separate, more privileged route: `agent-presence/[userId]`).
 */
export async function GET() {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;
  const presence = await getOrCreateAgentPresence(guard.ctx, guard.session.userId);
  return NextResponse.json(presence);
}

export async function PATCH(request: Request) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetAgentPresenceStateRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid presence state.", status: 422 }, { status: 422 });
  }

  try {
    const presence = await setMyPresenceState(guard.ctx, guard.session.userId, body.state);
    return NextResponse.json(presence);
  } catch (err) {
    return problemResponse(err);
  }
}
