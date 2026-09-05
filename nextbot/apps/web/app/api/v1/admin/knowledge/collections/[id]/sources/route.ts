import { NextResponse, type NextRequest } from "next/server";
import { handleListSources, handleCreateSource } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/collections/:id/sources` (RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ sources: await handleListSources(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `POST /api/v1/admin/knowledge/collections/:id/sources` (RBAC: knowledge=Write) —
 *  adding a source (regardless of kind) never changes retrieval behavior, so this
 *  is `knowledge`-only, never `knowledge_config`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const body = await request.json();
    return NextResponse.json({ source: await handleCreateSource(guard.ctx, { ...body, collectionId: id }) }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
