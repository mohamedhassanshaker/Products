import { NextResponse } from "next/server";
import { handleGetCollectionFreshness } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — `GET
 * /api/v1/admin/knowledge/collections/:id/freshness` (RBAC: knowledge=Read). Backs
 * the collection detail screen's staleness badge — a read-only computed indicator,
 * never a mutation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetCollectionFreshness(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
