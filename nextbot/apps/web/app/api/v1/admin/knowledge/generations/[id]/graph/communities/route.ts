import { NextResponse } from "next/server";
import { handleListGraphCommunities } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/generations/:id/graph/communities?level` (RBAC:
 *  knowledge=Read — LLD §14.4.5). `level` is optional — Phase 7b's ingestion
 *  pipeline only ever populates level 0 today (its own disclosed single-level
 *  narrowing), so an unfiltered request already returns every community that
 *  exists. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const url = new URL(request.url);
  const levelParam = url.searchParams.get("level");
  try {
    const communities = await handleListGraphCommunities(guard.ctx, id, levelParam !== null ? Number(levelParam) : undefined);
    return NextResponse.json({ communities });
  } catch (err) {
    return problemResponse(err);
  }
}
