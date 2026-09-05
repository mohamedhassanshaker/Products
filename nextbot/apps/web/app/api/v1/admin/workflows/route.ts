import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateWorkflowRequestSchema } from "@nextbot/contracts";
import { handleCreateWorkflow, handleListWorkflows } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4).
 *
 * `GET /api/v1/admin/workflows` (RBAC: `agent_platform=Read`). Workflows are part
 * of the Agent Platform surface, not a new RBAC module — the same precedent the
 * Skills Library and Teams already set (spec §5.2).
 */
export async function GET(): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ workflows: await handleListWorkflows(guard.ctx) });
}

/** `POST /api/v1/admin/workflows` (RBAC: `agent_platform=Write`) — creates a
 * workflow with a real version 1 (there is no "empty" workflow, same convention
 * as skills/teams). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
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
