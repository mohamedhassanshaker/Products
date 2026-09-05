import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateModelProviderRequestSchema } from "@nextbot/contracts";
import { handleDeactivateProvider, handleUpdateProvider } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PATCH /api/v1/admin/model-gateway/providers/{id}` (RBAC: agent_platform=Write). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateModelProviderRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model provider payload.", status: 422 }, { status: 422 });
  }
  try {
    const provider = await handleUpdateProvider(guard.ctx, id, body);
    return NextResponse.json({ provider });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/model-gateway/providers/{id}` (RBAC: agent_platform=Write) —
 * a soft-disable (`enabled=false`), never a hard delete (FR-AGT-20's console
 * requirement — see `deactivateProviderRegistration`'s doc comment). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const provider = await handleDeactivateProvider(guard.ctx, id);
    return NextResponse.json({ provider });
  } catch (err) {
    return problemResponse(err);
  }
}
