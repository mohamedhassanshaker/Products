import { NextResponse } from "next/server";
import { handleCancelGeneration } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/knowledge/generations/:id/cancel` (RBAC: knowledge_config=Write). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge_config", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleCancelGeneration(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
