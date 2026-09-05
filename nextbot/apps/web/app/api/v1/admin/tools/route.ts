import { NextResponse, type NextRequest } from "next/server";
import { handleListTools } from "@nextbot/tool-registry";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/tools?connectorId=` — catalog list (RBAC: tool_permissions=Read). */
export async function GET(request: NextRequest) {
  const guard = await requireApi("tool_permissions", "Read");
  if (guard instanceof Response) return guard;
  const connectorId = request.nextUrl.searchParams.get("connectorId") ?? undefined;
  const tools = await handleListTools(guard.ctx, connectorId);
  return NextResponse.json({ tools });
}
