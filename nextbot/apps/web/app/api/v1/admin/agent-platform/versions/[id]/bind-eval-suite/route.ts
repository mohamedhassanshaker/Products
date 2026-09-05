import { NextResponse, type NextRequest } from "next/server";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { handleBindEvalSuite } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

const BindEvalSuiteRequestSchema = Type.Object({ evalSuiteId: Type.String({ format: "uuid" }) });

/** `POST /api/v1/admin/agent-platform/versions/:id/bind-eval-suite` (RBAC: agent_platform=Write). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(BindEvalSuiteRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid request.", status: 422 }, { status: 422 });
  }
  try {
    await handleBindEvalSuite(guard.ctx, id, body.evalSuiteId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
