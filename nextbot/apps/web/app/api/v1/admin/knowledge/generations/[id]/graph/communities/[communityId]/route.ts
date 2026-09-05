import { NextResponse } from "next/server";
import { handleGetGraphCommunity } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/generations/:id/graph/communities/:communityId` —
 *  community detail plus its member entities (RBAC: knowledge=Read — FR-KB-04:
 *  "entities grouped by community, with the community's own generated summary
 *  visible"). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; communityId: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id, communityId } = await params;
  try {
    return NextResponse.json(await handleGetGraphCommunity(guard.ctx, id, communityId));
  } catch (err) {
    return problemResponse(err);
  }
}
