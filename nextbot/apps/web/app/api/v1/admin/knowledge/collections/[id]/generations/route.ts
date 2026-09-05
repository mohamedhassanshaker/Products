import { NextResponse, type NextRequest } from "next/server";
import { handleListGenerations, handleBuildGeneration } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/collections/:id/generations` (RBAC: knowledge=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ generations: await handleListGenerations(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `POST /api/v1/admin/knowledge/collections/:id/generations {confirmReEmbed?}`
 *  (FR-KB-03 — 409 EMBEDDING_MODEL_CHANGE_REQUIRES_REEMBED without confirmation).
 *  RBAC: `knowledge_config`, since building a generation is what actually applies
 *  the currently-configured embedding/extraction model — matching this module's
 *  own split (a curator without `knowledge_config` can add sources but not trigger
 *  a build that would bind them to a specific model choice). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("knowledge_config", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ generation: await handleBuildGeneration(guard.ctx, id, body) }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
