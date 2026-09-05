import { NextResponse } from "next/server";
import { handlePublishRouteVersion } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/model-gateway/routes/{id}/versions/{vid}/publish` (RBAC:
 * agent_platform=Write). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id, vid } = await params;
  try {
    return NextResponse.json({ version: await handlePublishRouteVersion(guard.ctx, id, vid) });
  } catch (err) {
    return problemResponse(err);
  }
}
