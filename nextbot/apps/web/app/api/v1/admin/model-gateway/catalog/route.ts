import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateModelCatalogEntryRequestSchema } from "@nextbot/contracts";
import { handleDeclareCatalogEntry, handleListCatalog } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/catalog?providerId&modality&status`
 * (RBAC: agent_platform=Read). */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const url = new URL(request.url);
  const providerId = url.searchParams.get("providerId") ?? undefined;
  const modality = url.searchParams.get("modality") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const entries = await handleListCatalog(guard.ctx, { providerId, modality, status });
  return NextResponse.json({ entries });
}

/** `POST /api/v1/admin/model-gateway/catalog` (RBAC: agent_platform=Write) — manual
 * declaration (FR-AGT-21), the path for provider types with no discovery API. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateModelCatalogEntryRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model catalog entry payload.", status: 422 }, { status: 422 });
  }
  try {
    const entry = await handleDeclareCatalogEntry(guard.ctx, body);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
