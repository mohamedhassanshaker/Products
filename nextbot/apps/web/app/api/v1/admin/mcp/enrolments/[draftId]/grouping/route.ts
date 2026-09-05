import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { McpGroupingRequestSchema } from "@nextbot/contracts";
import { handleSubmitGrouping } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PUT /api/v1/admin/mcp/enrolments/{draftId}/grouping` — wizard step 6 (single-
 * valued capability-group assignment, LLD §14.3.3 — no bridge table). */
export async function PUT(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(McpGroupingRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid grouping payload.", status: 422 }, { status: 422 });
  }

  try {
    const draft = await handleSubmitGrouping(guard.ctx, draftId, body);
    return NextResponse.json({ draft });
  } catch (err) {
    return problemResponse(err);
  }
}
