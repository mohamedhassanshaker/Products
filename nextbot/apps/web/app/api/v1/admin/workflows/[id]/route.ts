import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateWorkflowRequestSchema } from "@nextbot/contracts";
import { handleGetWorkflow, handleUpdateWorkflow } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/workflows/{id}` (RBAC: `agent_platform=Read`) — LLD §14.6.4. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetWorkflow(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}

/** `PATCH /api/v1/admin/workflows/{id}` (RBAC: `agent_platform=Write`) —
 * description and status only. A workflow's graph is never edited in place; that
 * is what an immutable new version is for. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateWorkflowRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid workflow payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleUpdateWorkflow(guard.ctx, id, body));
  } catch (err) {
    return problemResponse(err);
  }
}
