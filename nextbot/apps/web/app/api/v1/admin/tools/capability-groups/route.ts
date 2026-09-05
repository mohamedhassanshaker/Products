import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateCapabilityGroupRequestSchema } from "@nextbot/contracts";
import { handleListCapabilityGroupsWithToolCounts, handleCreateCapabilityGroup } from "@nextbot/tool-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/tools/capability-groups` — the tenant's real `capability_group`
 * rows (LLD §3.6), each annotated with a live count of member tools, for
 * admin-console pickers that need to offer real capability-group names instead of
 * free text (Phase 10, client-feedback-batch item 8 — Design Studio's Tool Policy
 * section). RBAC: `tool_permissions=Read`, matching the sibling
 * `GET /api/v1/admin/tools` catalog route's own gate exactly (`apps/web/app/api/v1/
 * admin/tools/route.ts`) — this is read-only tool-registry domain data, not a
 * mutation, so it doesn't need the stricter `agent_tool_config=Write` module that
 * gates actually assigning a tool to a group.
 *
 * Tenant isolation: `requireApi` resolves `ctx` from the caller's own session (never
 * from a client-supplied tenant id), and the repository layer both scopes every query
 * by `ctx.tenantId` explicitly and runs inside `withTenant`'s RLS-enforcing
 * transaction — the same double-enforcement this module's other tenant-scoped reads
 * already rely on.
 */
export async function GET() {
  const guard = await requireApi("tool_permissions", "Read");
  if (guard instanceof Response) return guard;
  try {
    const capabilityGroups = await handleListCapabilityGroupsWithToolCounts(guard.ctx);
    return NextResponse.json({ capabilityGroups });
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `POST /api/v1/admin/tools/capability-groups` (Phase 6, BL-28, FR-MCP-17) — creates a
 * new `capability_group` row. RBAC: `agent_tool_config=Write` — the same mutate-level
 * module the sibling tool-catalog mutations (`PATCH /api/v1/admin/tools/:id`) already
 * require, since creating/editing/deleting a group is exactly that class of tool-
 * registry configuration change, not a read.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_tool_config", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateCapabilityGroupRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid capability-group request.", status: 422 }, { status: 422 });
  }
  try {
    const id = await handleCreateCapabilityGroup(guard.ctx, body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
