import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { McpDryRunRequestSchema } from "@nextbot/contracts";
import { handleSubmitDryRun } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/mcp/enrolments/{draftId}/dry-run` — wizard step 8. Invokes
 * ONE already-classified, enabled read-only tool against the Sandbox binding and
 * shows the raw result before anything is enrolled — never Production, regardless
 * of what the caller's `environment` field says (see `submitDryRun`'s doc comment).
 */
export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(McpDryRunRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid dry-run payload.", status: 422 }, { status: 422 });
  }

  try {
    const { response } = await handleSubmitDryRun(guard.ctx, draftId, body);
    return NextResponse.json(response);
  } catch (err) {
    return problemResponse(err);
  }
}
