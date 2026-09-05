import { NextResponse } from "next/server";
import { handleGetChunk } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/knowledge/chunks/:id` (RBAC: knowledge=Read) — the Graph
 * Explorer's provenance drill-down terminal step (FR-KB-04): returns the chunk's
 * ACTUAL TEXT plus its document/source context, never merely an id. No dedicated
 * entry in LLD §14.4.5's literal endpoint list — a disclosed, necessary addition,
 * since FR-KB-04's own text requires exactly this capability ("clicking through
 * must show the actual chunk text") and no listed endpoint serves a single chunk.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ chunk: await handleGetChunk(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}
