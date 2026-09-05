import { NextResponse, type NextRequest } from "next/server";
import { handleListSources, handleCreateSource } from "@nextbot/knowledge";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/knowledge/collections/:id/sources` (RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ sources: await handleListSources(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `POST /api/v1/external/knowledge/collections/:id/sources` (RBAC: knowledge=Write). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const body = await request.json();
    return NextResponse.json({ source: await handleCreateSource(guard.ctx, { ...body, collectionId: id }) }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
