import { NextResponse, type NextRequest } from "next/server";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { queryMaskedAuditLog } from "@/src/lib/audit-query";

/** `GET /api/v1/admin/audit-log` (RBAC: audit_log=Read, B.8.2). Filters: actionType,
 * targetType, actor, date-range (from/to), outcome, free-text search, limit/offset.
 *
 * QA fix (UI-D1, UI-D2): `actor`/`from`/`to` filters are now wired through (were
 * previously accepted by `queryAuditLog` but never exposed here); `details` is now
 * masked via `queryMaskedAuditLog` before it ever reaches the client — see that
 * module's doc comment for why this replaces the never-built `.../{id}/masked`
 * endpoint a prior dispatch's code comment promised.
 *
 * **Flagged, not silently changed**: the spec prose (B.8.2) names the Outcome enum
 * as "Success/Failure/Pending", but the real `audit_outcome` DB enum — and every
 * call site that writes an audit outcome (guardrail policy denial, circuit-breaker
 * egress block, etc., see `orchestration`/`gateway`'s `outcome: "Denied"` usage) —
 * is actually `Success/Failure/Denied`. "Denied" is live, load-bearing business
 * semantics (a tool call blocked by policy), not a typo; renaming the enum to match
 * the spec's wording would be a breaking schema change across several already-
 * verified-correct modules for a one-word spec/implementation naming mismatch. Kept
 * as `Success/Failure/Denied` (the real, working enum) and flagged in
 * `docs/NEXUS_STATE.md` for the architect/spec owner to reconcile, rather than
 * decided unilaterally here. */
export async function GET(request: NextRequest) {
  const guard = await requireApi("audit_log", "Read");
  if (guard instanceof Response) return guard;

  const params = request.nextUrl.searchParams;
  try {
    const rows = await queryMaskedAuditLog(guard.ctx, {
      actionType: params.get("actionType") ?? undefined,
      targetType: params.get("targetType") ?? undefined,
      actorId: params.get("actor") ?? undefined,
      outcome: (params.get("outcome") as "Success" | "Failure" | "Denied" | null) ?? undefined,
      from: params.get("from") ? new Date(params.get("from")!) : undefined,
      to: params.get("to") ? new Date(params.get("to")!) : undefined,
      search: params.get("search") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      offset: params.get("offset") ? Number(params.get("offset")) : undefined,
    });
    return NextResponse.json({ entries: rows });
  } catch (err) {
    return problemResponse(err);
  }
}
