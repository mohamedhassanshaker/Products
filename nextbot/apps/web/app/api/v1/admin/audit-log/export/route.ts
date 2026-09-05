import { NextResponse, type NextRequest } from "next/server";
import { auditLogToCsv, auditLogToJson } from "@nextbot/audit";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { queryMaskedAuditLog } from "@/src/lib/audit-query";

/** `GET /api/v1/admin/audit-log/export?format=csv|json` (RBAC: audit_log=Read,
 * B.8.2's export action). Rate-limit note: unlike the widget's anonymous surfaces,
 * this endpoint is already RBAC-gated behind an authenticated admin session — the
 * rate-limiting gap this dispatch's gotcha list calls out applies to
 * unauthenticated endpoints; an authenticated export is bounded by the session's
 * own request rate, not a separate concern this phase adds new infrastructure for.
 *
 * QA fix (UI-D2): exports now go through `queryMaskedAuditLog` (same masked read
 * path the list/detail-drawer uses) instead of `queryAuditLog`'s raw rows — an
 * export is exactly the kind of artifact that leaves the admin session's control,
 * so it must never carry unmasked PII either. */
export async function GET(request: NextRequest) {
  const guard = await requireApi("audit_log", "Read");
  if (guard instanceof Response) return guard;

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "json" ? "json" : "csv";
  try {
    const rows = await queryMaskedAuditLog(guard.ctx, { limit: 5000 });
    const body = format === "json" ? auditLogToJson(rows) : auditLogToCsv(rows);
    return new NextResponse(body, {
      headers: {
        "content-type": format === "json" ? "application/json" : "text/csv",
        "content-disposition": `attachment; filename="audit-log.${format}"`,
      },
    });
  } catch (err) {
    return problemResponse(err);
  }
}
