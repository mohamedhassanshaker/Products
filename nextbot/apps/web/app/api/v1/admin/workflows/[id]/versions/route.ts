import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateWorkflowVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateWorkflowVersion, handleListWorkflowVersions } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/workflows/{id}/versions` (RBAC: `agent_platform=Read`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleListWorkflowVersions(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `POST /api/v1/admin/workflows/{id}/versions` (RBAC: `agent_platform=Write`) —
 * mints the next immutable version. Strict: every V1-V12 failure is a 422 here,
 * where the sibling `.../validate` endpoint reports the same failures without
 * saving anything.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateWorkflowVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid workflow version payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleCreateWorkflowVersion(guard.ctx, id, body, guard.session.userId), { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
