import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateAgentDefinitionRequestSchema } from "@nextbot/contracts";
import { handleCreateDefinition, handleListDefinitions } from "@nextbot/agent-platform";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-01) — Public API.
 *
 * `GET /api/v1/external/agent-platform/definitions` (bearer-key or session, RBAC:
 * agent_platform=Read). Delegates to the EXACT SAME `@nextbot/agent-platform` handler
 * function `/api/v1/admin/agent-platform/definitions` calls — this is a new
 * auth/route layer over already-shipped business logic, never a second
 * implementation of it.
 */
export async function GET(): Promise<NextResponse | Response> {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ definitions: await handleListDefinitions(guard.ctx) });
}

/** `POST /api/v1/external/agent-platform/definitions` (RBAC: agent_platform=Write). */
export async function POST(request: NextRequest) {
  const guard = await requirePublicApi("agent_platform", "Write");
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
