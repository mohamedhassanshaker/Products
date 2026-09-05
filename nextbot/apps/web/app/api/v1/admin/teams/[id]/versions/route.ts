import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateTeamVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateTeamVersion, handleListTeamVersions } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/teams/{id}/versions` (RBAC: `agent_platform=Read`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleListTeamVersions(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `POST /api/v1/admin/teams/{id}/versions` (RBAC: `agent_platform=Write`) — mints the
 * next immutable version. Strict validation: a non-router-class supervisor route is
 * a 422 `TEAM_SUPERVISOR_ROUTE_EXPENSIVE` here (FR-ORC-03), where the sibling
 * `.../validate` endpoint reports the same condition as a 200-with-warning.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateTeamVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid team version payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleCreateTeamVersion(guard.ctx, id, body, guard.session.userId), { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
