import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateWorkflowRequestSchema } from "@nextbot/contracts";
import { handleCreateWorkflow, handleListWorkflows } from "@nextbot/workflows";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/workflows` (RBAC: agent_platform=Read). */
export async function GET(): Promise<NextResponse | Response> {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ workflows: await handleListWorkflows(guard.ctx) });
}

/** `POST /api/v1/external/workflows` (RBAC: agent_platform=Write). */
export async function POST(request: NextRequest) {
  const guard = await requirePublicApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateWorkflowRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid workflow payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleCreateWorkflow(guard.ctx, body, guard.session.userId), { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
