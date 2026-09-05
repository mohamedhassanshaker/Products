import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateModelRouteRequestSchema } from "@nextbot/contracts";
import { handleCreateRoute, handleListRoutes } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/routes` (RBAC: agent_platform=Read). */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ routes: await handleListRoutes(guard.ctx) });
}

/** `POST /api/v1/admin/model-gateway/routes` (RBAC: agent_platform=Write) — creates
 * the route IDENTITY only (FR-AGT-22); its first version is created separately via
 * `POST .../routes/{id}/versions`. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateModelRouteRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model route payload.", status: 422 }, { status: 422 });
  }
  try {
    const route = await handleCreateRoute(guard.ctx, body);
    return NextResponse.json({ route }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
