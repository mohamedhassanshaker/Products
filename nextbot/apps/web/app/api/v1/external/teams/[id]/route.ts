import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateTeamRequestSchema } from "@nextbot/contracts";
import { handleGetTeam, handleUpdateTeam } from "@nextbot/teams";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/teams/{id}` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetTeam(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}

/** `PATCH /api/v1/external/teams/{id}` (RBAC: agent_platform=Write) — description and
 * status only; composition is immutable per version. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateTeamRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid team payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleUpdateTeam(guard.ctx, id, body));
  } catch (err) {
    return problemResponse(err);
  }
}
