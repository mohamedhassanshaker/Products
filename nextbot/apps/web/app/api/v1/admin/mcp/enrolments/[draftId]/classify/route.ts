import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { McpClassifyRequestSchema } from "@nextbot/contracts";
import { handleSubmitClassify } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PUT /api/v1/admin/mcp/enrolments/{draftId}/classify` — wizard step 5. */
export async function PUT(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(McpClassifyRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid classification payload.", status: 422 }, { status: 422 });
  }

  try {
    const draft = await handleSubmitClassify(guard.ctx, draftId, body);
    return NextResponse.json({ draft });
  } catch (err) {
    return problemResponse(err);
  }
}
