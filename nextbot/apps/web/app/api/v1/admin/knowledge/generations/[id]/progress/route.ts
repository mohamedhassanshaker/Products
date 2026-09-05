import { NextResponse } from "next/server";
import { handleGetGenerationProgress } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/generations/:id/progress` (RBAC: knowledge=Read) —
 *  poll every 2s per LLD §14.4.5. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetGenerationProgress(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
