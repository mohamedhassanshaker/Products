import { NextResponse, type NextRequest } from "next/server";
import { handleSyncProviderCatalog } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/model-gateway/providers/{id}/sync-catalog`
 * (RBAC: agent_platform=Write) — on-demand catalog sync (ADR-0011 §2.1); rejects with
 * `MODEL_CATALOG_SYNC_UNSUPPORTED` (422) for a provider type with no discovery API. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const outcome = await handleSyncProviderCatalog(guard.ctx, id);
    return NextResponse.json(outcome);
  } catch (err) {
    return problemResponse(err);
  }
}
