import { NextResponse, type NextRequest } from "next/server";
import { handleUpdateCollectionConfig } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PATCH /api/v1/admin/knowledge/collections/:id/config` — the narrower
 *  `knowledge_config` module: embedding/rerank model choice, chunking/extraction
 *  policy. Split from the general collection PATCH so a curator (`knowledge`-only)
 *  can never change retrieval behavior, per blueprint §5.2's own rationale. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge_config", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const body = await request.json();
    return NextResponse.json({ collection: await handleUpdateCollectionConfig(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
