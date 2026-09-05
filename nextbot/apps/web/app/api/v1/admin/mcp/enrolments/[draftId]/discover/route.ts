import { NextResponse } from "next/server";
import { handleSubmitDiscover } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/mcp/enrolments/{draftId}/discover` — wizard step 4, the
 * discovery handshake against the Sandbox binding (connect, enumerate tools/
 * resources/prompts, hash into the pinned manifest — Phase 0's exact
 * `computeSchemaHash`/`computeManifestHash`). */
export async function POST(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;
  try {
    const { response } = await handleSubmitDiscover(guard.ctx, draftId);
    return NextResponse.json(response);
  } catch (err) {
    return problemResponse(err);
  }
}
