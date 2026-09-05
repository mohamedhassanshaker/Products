import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateAgentDefinitionRequestSchema } from "@nextbot/contracts";
import { handleCreateDefinition, handleListDefinitions } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/definitions` (RBAC: agent_platform=Read). */
export async function GET(): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ definitions: await handleListDefinitions(guard.ctx) });
}

/** `POST /api/v1/admin/agent-platform/definitions` (RBAC: agent_platform=Write). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateAgentDefinitionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid agent definition payload.", status: 422 }, { status: 422 });
  }
  try {
    const definition = await handleCreateDefinition(guard.ctx, body);
    return NextResponse.json({ definition }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
