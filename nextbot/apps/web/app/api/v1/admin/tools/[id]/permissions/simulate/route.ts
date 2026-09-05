import { NextResponse } from "next/server";
import { handleSimulatePermission } from "@nextbot/tool-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/tools/{id}/permissions/simulate` — preview which rule would
 * fire for a hypothetical context (RBAC: tool_permissions=Read — this is read-only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("tool_permissions", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const resolution = await handleSimulatePermission(guard.ctx, id, body);
    return NextResponse.json(resolution);
  } catch (err) {
    return problemResponse(err);
  }
}
