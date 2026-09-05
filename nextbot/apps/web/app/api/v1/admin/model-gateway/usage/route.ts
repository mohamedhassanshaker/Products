import { NextResponse, type NextRequest } from "next/server";
import { handleGetUsageReport } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

const VALID_GROUP_BY = new Set(["provider", "model", "route", "agentVersion", "channel"]);

/** `GET /api/v1/admin/model-gateway/usage?from&to&groupBy=` (RBAC: agent_platform=Read,
 * FR-AGT-24 — spend/volume by provider/model/route/agent-version/channel). */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = url.searchParams.get("to") ?? new Date().toISOString();
  const groupBy = url.searchParams.get("groupBy") ?? "provider";
  if (!VALID_GROUP_BY.has(groupBy)) {
    return NextResponse.json({ type: "about:blank", title: `Invalid groupBy '${groupBy}'.`, status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ rows: await handleGetUsageReport(guard.ctx, { from, to, groupBy: groupBy as Parameters<typeof handleGetUsageReport>[1]["groupBy"] }) });
  } catch (err) {
    return problemResponse(err);
  }
}
