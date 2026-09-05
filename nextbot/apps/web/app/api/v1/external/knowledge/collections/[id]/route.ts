import { NextResponse, type NextRequest } from "next/server";
import { handleGetCollection, handleUpdateCollection, handleDeleteCollection } from "@nextbot/knowledge";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/knowledge/collections/:id` (RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ collection: await handleGetCollection(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `PATCH /api/v1/external/knowledge/collections/:id` — general fields only (RBAC:
 * knowledge=Write); embedding/chunking config changes stay console-only via
 * `.../config`, not exposed on this public surface's initial cut. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const body = await request.json();
    return NextResponse.json({ collection: await handleUpdateCollection(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/external/knowledge/collections/:id` (soft delete, RBAC: knowledge=Write). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleDeleteCollection(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
