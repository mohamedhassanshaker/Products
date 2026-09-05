import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateEvalSuiteRequestSchema } from "@nextbot/contracts";
import { handleCreateEvalSuite, handleListEvalSuites } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/eval-suites` (RBAC: agent_platform=Read). */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ suites: await handleListEvalSuites(guard.ctx) });
}

/** `POST /api/v1/admin/agent-platform/eval-suites` (RBAC: agent_platform=Write). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateEvalSuiteRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid eval suite payload.", status: 422 }, { status: 422 });
  }
  try {
    const suite = await handleCreateEvalSuite(guard.ctx, body);
    return NextResponse.json({ suite }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
