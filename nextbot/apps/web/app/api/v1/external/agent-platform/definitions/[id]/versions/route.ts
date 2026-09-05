import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateAgentDefinitionVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateVersion, handleListVersions } from "@nextbot/agent-platform";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/agent-platform/definitions/:id/versions` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ versions: await handleListVersions(guard.ctx, id, guard.session.userId) });
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `POST /api/v1/external/agent-platform/definitions/:id/versions` (RBAC:
 * agent_platform=Write). Immutability/promotion-gate rules apply IDENTICALLY to a
 * version created via this route — it is the same `handleCreateVersion` call the
 * console's own `/admin` route makes, there is no alternate, looser path.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateAgentDefinitionVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid agent definition version payload.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handleCreateVersion(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
