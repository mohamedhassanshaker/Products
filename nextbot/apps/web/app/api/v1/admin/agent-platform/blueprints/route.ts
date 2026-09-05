import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateAgentBlueprintRequestSchema } from "@nextbot/contracts";
import { handleCreateAgentBlueprint, handleListAgentBlueprints } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/blueprints` (RBAC: agent_platform=Read) —
 * the Blueprints Gallery, tenant-local starter templates only (FR-AGT-15). */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ blueprints: await handleListAgentBlueprints(guard.ctx) });
}

/** `POST /api/v1/admin/agent-platform/blueprints` (RBAC: agent_platform=Write)
 * — saves a working Studio draft's artifact as a reusable, tenant-local
 * starter template. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateAgentBlueprintRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid blueprint payload.", status: 422 }, { status: 422 });
  }
  try {
    const blueprint = await handleCreateAgentBlueprint(guard.ctx, body, guard.session.userId);
    return NextResponse.json({ blueprint }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
