import { NextResponse, type NextRequest } from "next/server";
import { handleGetCollection, handleUpdateCollection, handleDeleteCollection } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/collections/:id` (RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ collection: await handleGetCollection(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `PATCH /api/v1/admin/knowledge/collections/:id` — general fields only (name,
 *  description, retention, default strategy, staleness, min relevance). Embedding/
 *  chunking/extraction config changes go through `.../config` instead (RBAC:
 *  knowledge=Write). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const body = await request.json();
    return NextResponse.json({ collection: await handleUpdateCollection(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/knowledge/collections/:id` (soft delete, RBAC: knowledge=Write). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleDeleteCollection(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
