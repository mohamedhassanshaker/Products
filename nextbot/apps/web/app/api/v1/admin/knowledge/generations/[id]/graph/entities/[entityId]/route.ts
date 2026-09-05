import { NextResponse } from "next/server";
import { handleGetGraphEntity } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/knowledge/generations/:id/graph/entities/:entityId` — entity
 * detail plus EVERY relation touching it (either direction) plus each relation's
 * provenance (LLD §14.4.5's "+ relations + provenance"; RBAC: knowledge=Read). This
 * is the Graph Explorer's FR-KB-04 critical path — a curator lands here from the
 * entity list, then follows a relation's `provenance.chunkId` to
 * `/api/v1/admin/knowledge/chunks/:id` to see the actual source sentence.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; entityId: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id, entityId } = await params;
  try {
    return NextResponse.json(await handleGetGraphEntity(guard.ctx, id, entityId));
  } catch (err) {
    return problemResponse(err);
  }
}
