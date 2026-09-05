import { NextResponse, type NextRequest } from "next/server";
import { handleListCollections, handleCreateCollection } from "@nextbot/knowledge";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/knowledge/collections` (RBAC: knowledge=Read). */
export async function GET() {
  const guard = await requirePublicApi("knowledge", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ collections: await handleListCollections(guard.ctx) });
}

/** `POST /api/v1/external/knowledge/collections` — same dual-gate as the console's
 * own route: creation sets both general collection fields (`knowledge`) and the
 * embedding/extraction route pins (`knowledge_config`), so both are required. */
export async function POST(request: NextRequest) {
  const guard = await requirePublicApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  const configGuard = await requirePublicApi("knowledge_config", "Write");
  if (configGuard instanceof Response) return configGuard;
  try {
    const body = await request.json();
    return NextResponse.json({ collection: await handleCreateCollection(guard.ctx, body) }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
