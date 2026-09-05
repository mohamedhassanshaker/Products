import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateTeamRequestSchema } from "@nextbot/contracts";
import { handleCreateTeam, handleListTeams } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5).
 *
 * `GET /api/v1/admin/teams` (RBAC: `agent_platform=Read`). Teams are part of the
 * Agent Platform surface, not a new RBAC module — the same precedent the Skills
 * Library and the delegation-tree endpoint already set (spec §5.2's "Changed — now
 * also gates skills").
 */
export async function GET(): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ teams: await handleListTeams(guard.ctx) });
}

/** `POST /api/v1/admin/teams` (RBAC: `agent_platform=Write`) — creates a team with a
 * real version 1 (there is no "empty" team, same convention as skills). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateTeamRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid team payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleCreateTeam(guard.ctx, body, guard.session.userId), { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
