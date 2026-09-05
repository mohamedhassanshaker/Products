import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateEvalCaseRequestSchema } from "@nextbot/contracts";
import { handleAddEvalCase, handleListEvalCases } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/eval-suites/:id/cases` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  return NextResponse.json({ cases: await handleListEvalCases(guard.ctx, id) });
}

/** `POST /api/v1/admin/agent-platform/eval-suites/:id/cases` (RBAC: agent_platform=Write). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateEvalCaseRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid eval case payload.", status: 422 }, { status: 422 });
  }
  try {
    const evalCase = await handleAddEvalCase(guard.ctx, id, body);
    return NextResponse.json({ case: evalCase }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
