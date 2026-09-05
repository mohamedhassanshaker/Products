import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateModelRouteVersionRequestSchema } from "@nextbot/contracts";
import { handleValidateRouteVersion } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/model-gateway/routes/{id}/versions/validate` (RBAC:
 * agent_platform=Write) — dry run, never saves (LLD §14.8.5), for a console
 * "check before you save" affordance. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateModelRouteVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model route version payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleValidateRouteVersion(guard.ctx, id, body));
  } catch (err) {
    return problemResponse(err);
  }
}
