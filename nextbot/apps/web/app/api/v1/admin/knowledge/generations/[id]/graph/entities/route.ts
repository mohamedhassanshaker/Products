import { NextResponse } from "next/server";
import { handleListGraphEntities } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/knowledge/generations/:id/graph/entities?q&type&communityId&minDegree&cursor&limit`
 * (RBAC: knowledge=Read — LLD §14.4.5). The Graph Explorer's own entity browser
 * (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04) — read-only, no mutation
 * capability added by this phase.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const url = new URL(request.url);
  const minDegreeParam = url.searchParams.get("minDegree");
  const limitParam = url.searchParams.get("limit");
  try {
    const result = await handleListGraphEntities(guard.ctx, id, {
      q: url.searchParams.get("q") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      communityId: url.searchParams.get("communityId") ?? undefined,
      minDegree: minDegreeParam ? Number(minDegreeParam) : undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
