import { NextResponse } from "next/server";
import { handleGetSourceFailures } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/sources/:id/failures` (FR-KB-01, RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetSourceFailures(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
