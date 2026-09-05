import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateModelCatalogEntryRequestSchema } from "@nextbot/contracts";
import { handleDeleteCatalogEntry, handleUpdateCatalogEntry } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PATCH /api/v1/admin/model-gateway/catalog/{id}` (RBAC: agent_platform=Write). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateModelCatalogEntryRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model catalog entry payload.", status: 422 }, { status: 422 });
  }
  try {
    const entry = await handleUpdateCatalogEntry(guard.ctx, id, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/model-gateway/catalog/{id}` (RBAC: agent_platform=Write) —
 * hard-deletes a `Manual` entry; a `Synced` entry is retired instead (ADR-0011 §4),
 * never deleted. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    await handleDeleteCatalogEntry(guard.ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
