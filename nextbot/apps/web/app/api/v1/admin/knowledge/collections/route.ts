import { NextResponse, type NextRequest } from "next/server";
import { handleListCollections, handleCreateCollection } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/knowledge/collections` (RBAC: knowledge=Read). */
export async function GET() {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ collections: await handleListCollections(guard.ctx) });
}

/**
 * `POST /api/v1/admin/knowledge/collections` — creation bundles both the general
 * collection fields (`knowledge`) and the embedding/extraction route pins
 * (`knowledge_config`), so both permissions are required (blueprint §5.2's split
 * governs CHANGING config on an existing collection without touching the rest;
 * initial creation necessarily sets both at once).
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const configGuard = await requireApi("knowledge_config", "Write");
  if (configGuard instanceof Response) return configGuard;
  try {
    const body = await request.json();
    return NextResponse.json({ collection: await handleCreateCollection(guard.ctx, body) }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
