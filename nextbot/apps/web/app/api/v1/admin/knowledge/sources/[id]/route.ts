import { NextResponse } from "next/server";
import { handleGetSource, handleDeleteSource } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/sources/:id` (RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ source: await handleGetSource(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/knowledge/sources/:id` (RBAC: knowledge=Write). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleDeleteSource(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
