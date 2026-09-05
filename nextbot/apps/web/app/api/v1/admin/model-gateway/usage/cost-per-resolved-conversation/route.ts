import { NextResponse, type NextRequest } from "next/server";
import { handleGetCostPerResolvedConversation } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/usage/cost-per-resolved-conversation?from&to`
 * (RBAC: agent_platform=Read, FR-AGT-24). */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = url.searchParams.get("to") ?? new Date().toISOString();
  try {
    return NextResponse.json(await handleGetCostPerResolvedConversation(guard.ctx, { from, to }));
  } catch (err) {
    return problemResponse(err);
  }
}
