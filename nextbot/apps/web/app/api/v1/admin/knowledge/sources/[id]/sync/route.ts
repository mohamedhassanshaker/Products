import { NextResponse } from "next/server";
import { handleSyncSource } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/knowledge/sources/:id/sync` (RBAC: knowledge=Write). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleSyncSource(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
