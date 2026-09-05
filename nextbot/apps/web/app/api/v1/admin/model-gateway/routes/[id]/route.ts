import { NextResponse } from "next/server";
import { handleGetRoute } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/routes/{id}` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ route: await handleGetRoute(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}
