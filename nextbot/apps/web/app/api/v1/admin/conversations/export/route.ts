import { NextResponse, type NextRequest } from "next/server";
import { listAllConversationsForExport } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";
import { parseConversationFilters } from "@/src/lib/conversation-filters";
import { toCsv } from "@/src/lib/csv";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { getSession } from "@/src/lib/session";

/** Caps abuse of an authenticated-but-still-expensive export endpoint (full-table
 * scan + serialization) — same rationale as the widget's per-session send limiter,
 * scoped per-user here since every caller is an authenticated admin session. */
const EXPORT_LIMIT = 10;
const EXPORT_WINDOW_SECONDS = 60;

/**
 * `GET /api/v1/admin/conversations/export?format=csv|json` (RBAC: conversations=Read).
 * Every row is tenant-scoped (never a cross-tenant leak — `listAllConversationsForExport`
 * runs through the same `withTenant`-gated query as the paged list) and capped at a
 * hard row ceiling server-side regardless of filter breadth (defense in depth).
 */
export async function GET(request: NextRequest) {
  const guard = await requireApi("conversations", "Read");
  if (guard instanceof Response) return guard;

  const session = await getSession();
  const rateLimit = await checkRateLimit(`conversation-export:${session?.userId ?? guard.ctx.tenantId}`, EXPORT_LIMIT, EXPORT_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { type: "about:blank", title: "Too many export requests — please wait a minute and try again.", status: 429 },
      { status: 429, headers: { "Retry-After": String(EXPORT_WINDOW_SECONDS) } },
    );
  }

  const filters = parseConversationFilters(request.nextUrl.searchParams);
  const format = request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
  const items = await listAllConversationsForExport(guard.ctx, filters);

  if (format === "json") {
    return NextResponse.json({ conversations: items });
  }

  const csv = toCsv(
    items.map((c) => ({
      id: c.id,
      channelId: c.channelId,
      status: c.status,
      recognizedGoal: c.recognizedGoal ?? "",
      resolutionType: c.resolutionType ?? "",
      language: c.language,
      startedAt: c.startedAt.toISOString(),
      endedAt: c.endedAt ? c.endedAt.toISOString() : "",
      totalCostUsd: c.totalCostUsd,
      totalTokensIn: c.totalTokensIn,
      totalTokensOut: c.totalTokensOut,
    })),
    ["id", "channelId", "status", "recognizedGoal", "resolutionType", "language", "startedAt", "endedAt", "totalCostUsd", "totalTokensIn", "totalTokensOut"],
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="conversations-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
