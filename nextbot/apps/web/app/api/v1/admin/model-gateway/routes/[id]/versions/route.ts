import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateModelRouteVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateRouteVersion, handleListRouteVersions } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/routes/{id}/versions` (RBAC: agent_platform=Read). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ versions: await handleListRouteVersions(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `POST /api/v1/admin/model-gateway/routes/{id}/versions` (RBAC: agent_platform=Write)
 * — FR-AGT-22's save-time capability/residency/plan-tier validation runs here; a
 * rejection returns 422 naming the offending hop(s), never a silent accept
 * (`RouteValidationFailedError`/`RouteCapabilityUnsatisfiedError`, LLD §14.8.5). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateModelRouteVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model route version payload.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handleCreateRouteVersion(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
