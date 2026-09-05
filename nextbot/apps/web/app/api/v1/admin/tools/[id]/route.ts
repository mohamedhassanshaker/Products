import { NextResponse } from "next/server";
import { handleSetCapabilityGroup, handleSetPriorityWeight, handleSetVisibility } from "@nextbot/tool-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

interface PatchBody {
  visibleToAgent?: boolean;
  priorityWeight?: number;
  capabilityGroupId?: string | null;
}

/**
 * `PATCH /api/v1/admin/tools/{id}` — agent-visibility toggle / priority weight /
 * capability group assignment (FR-MCP-13, RBAC: agent_tool_config=Write).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_tool_config", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;

  try {
    if (typeof body.visibleToAgent === "boolean") await handleSetVisibility(guard.ctx, id, body.visibleToAgent);
    if (typeof body.priorityWeight === "number") await handleSetPriorityWeight(guard.ctx, id, body.priorityWeight);
    if ("capabilityGroupId" in body) await handleSetCapabilityGroup(guard.ctx, id, body.capabilityGroupId ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
