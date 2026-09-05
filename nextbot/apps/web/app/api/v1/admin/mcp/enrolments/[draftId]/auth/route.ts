import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { McpAuthRequestSchema } from "@nextbot/contracts";
import { handleSubmitAuth } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PUT /api/v1/admin/mcp/enrolments/{draftId}/auth` — wizard step 3. Writes
 * credentials to the vault immediately (Sandbox and Production captured/stored
 * separately, FR-MCP-16 step 3); the response never echoes a plaintext secret back,
 * only the draft's `credentialId` pointers. */
export async function PUT(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(McpAuthRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid auth payload.", status: 422 }, { status: 422 });
  }

  try {
    const draft = await handleSubmitAuth(guard.ctx, draftId, body);
    return NextResponse.json({ draft });
  } catch (err) {
    return problemResponse(err);
  }
}
