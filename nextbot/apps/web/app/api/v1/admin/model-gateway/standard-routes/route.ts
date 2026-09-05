import { NextResponse } from "next/server";
import { handleGetStandardRoutes } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/standard-routes` (RBAC: agent_platform=Read) —
 * FR-AGT-23's recommended-routes checklist. */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  try {
    return NextResponse.json({ standardRoutes: await handleGetStandardRoutes(guard.ctx) });
  } catch (err) {
    return problemResponse(err);
  }
}
