import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { McpRuntimePolicySchema } from "@nextbot/contracts";
import { handleSubmitPolicy } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PUT /api/v1/admin/mcp/enrolments/{draftId}/policy` — wizard step 7 (timeout,
 * retry, circuit breaker, per-tool rate limit, cost attribution, egress allowlist). */
export async function PUT(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(McpRuntimePolicySchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid runtime policy payload.", status: 422 }, { status: 422 });
  }

  try {
    const draft = await handleSubmitPolicy(guard.ctx, draftId, body);
    return NextResponse.json({ draft });
  } catch (err) {
    return problemResponse(err);
  }
}
