import "server-only";
import { queryAuditLog, type AuditLogFilters, type AuditLogEntryRow } from "@nextbot/audit";
import { buildPolicyLookup, maskJsonValue } from "@nextbot/pii";
import type { TenantContext } from "@nextbot/db";

/**
 * QA fix (UI-D2, FR-SEC-04) — the Audit Log Viewer's masked-read path.
 *
 * `@nextbot/audit`'s `queryAuditLog` deliberately returns `details` **unmasked**
 * (documented in its own doc comment: `audit`'s LLD §2.3 allow-list is
 * `["tenancy"]` only, so it cannot import `pii` and apply masking itself — that
 * is always a composition-root responsibility, same pattern as
 * `conversations`/`orchestration`'s cross-module boundary). The previous
 * dispatch left a code-comment promise of a separate `GET .../{id}/masked`
 * endpoint that was **never actually built**, so both the detail-drawer fetch
 * and the CSV/JSON export ended up reading `queryAuditLog`'s raw, unmasked rows
 * directly — a real PII leak, not a documented gap.
 *
 * This wrapper is now the *only* sanctioned way `apps/web` reads the audit log
 * for anything that reaches a client response (list, detail-drawer, export):
 * it runs `queryAuditLog` and then masks every row's `details` blob through the
 * tenant's own PII policy matrix (`Export` context — the most conservative of
 * the five contexts FR-SEC-04 defines, appropriate both for the list/detail
 * view and for a literal file export) before returning anything.
 *
 * `trustLevel` is fixed at `"Untrusted"` here: audit `details` originates from
 * many different actor/system call sites, several of which aren't provably
 * trusted at read time, and the masking-context matrix's own "fail closed"
 * rule (`buildPolicyLookup`'s absent-combination default is `FullMask`, never
 * `Show`) means choosing the least-privileged trust level here can only ever
 * make masking *more* conservative, never accidentally reveal more than a
 * tenant explicitly configured for `Untrusted`.
 */
export async function queryMaskedAuditLog(ctx: TenantContext, filters: AuditLogFilters): Promise<AuditLogEntryRow[]> {
  const [rows, resolvePolicy] = await Promise.all([queryAuditLog(ctx, filters), buildPolicyLookup(ctx)]);
  return rows.map((row) => ({
    ...row,
    details: maskJsonValue(row.details, "Export", "Untrusted", resolvePolicy) as Record<string, unknown>,
  }));
}
