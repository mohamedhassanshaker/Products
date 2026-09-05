import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateTeamVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateTeamVersion, handleListTeamVersions } from "@nextbot/teams";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/teams/{id}/versions` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleListTeamVersions(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}

/** `POST /api/v1/external/teams/{id}/versions` (RBAC: agent_platform=Write) — every
 * FR-ORC-03/11 authoring/validation rule applies identically here. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
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
