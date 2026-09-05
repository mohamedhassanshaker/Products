import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateCapabilityGroupRequestSchema } from "@nextbot/contracts";
import { handleUpdateCapabilityGroup, handleDeleteCapabilityGroup, handleCountToolsInCapabilityGroup } from "@nextbot/tool-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `PATCH /api/v1/admin/tools/capability-groups/:id` (Phase 6, BL-28, FR-MCP-17) —
 * renames/re-describes/re-weights an existing group. RBAC: `agent_tool_config=Write`,
 * matching the sibling create route.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_tool_config", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateCapabilityGroupRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid capability-group update.", status: 422 }, { status: 422 });
  }
  try {
    await handleUpdateCapabilityGroup(guard.ctx, id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `DELETE /api/v1/admin/tools/capability-groups/:id?confirm=1` (Phase 6, BL-28,
 * FR-MCP-17) — soft-deletes the group and reassigns its tools to Ungrouped in the same
 * transaction (LLD §14.3.3: never a cascade delete of the tools). Without `?confirm=1`,
 * returns the affected tool count instead of deleting anything, so the console's
 * confirmation dialog can show "this will un-group N tools" *before* the destructive
 * action — the same two-step shape this codebase already uses for other destructive
 * confirmations (see `AlertDialog` usage across the admin console).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_tool_config", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const confirmed = request.nextUrl.searchParams.get("confirm") === "1";
  try {
    if (!confirmed) {
      const affectedToolCount = await handleCountToolsInCapabilityGroup(guard.ctx, id);
      return NextResponse.json({ requiresConfirmation: true, affectedToolCount });
    }
    const result = await handleDeleteCapabilityGroup(guard.ctx, id);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
