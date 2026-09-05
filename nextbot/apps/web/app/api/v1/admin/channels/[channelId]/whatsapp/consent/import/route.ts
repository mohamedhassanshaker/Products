import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { BulkImportConsentRequestSchema } from "@nextbot/contracts";
import { handleDryRunBulkImportConsent, handleBulkImportConsent } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `POST /api/v1/admin/channels/:channelId/whatsapp/consent/import?commit=true` —
 * FR-META bulk import, with §7.2.5's explicit two-step dry-run-then-commit UX: the
 * default (no `?commit=true`) is a dry-run that validates every row and writes
 * nothing (FR-KB-01's per-item failure pattern — one bad row never blocks the
 * rest); `?commit=true` actually persists and records a `consent_import_log` row.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(BulkImportConsentRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid bulk import payload.", status: 422 }, { status: 422 });
  }

  const commit = new URL(request.url).searchParams.get("commit") === "true";

  try {
    const result = commit
      ? await handleBulkImportConsent(guard.ctx, channelId, body, guard.session.userId)
      : await handleDryRunBulkImportConsent(guard.ctx, body);

    if (commit) {
      await recordAdminAudit(guard.ctx, {
        actorId: guard.session.userId,
        actorLabel: guard.session.userId,
        actionType: "whatsapp.consent.bulk_import",
        targetType: "Channel",
        targetId: channelId,
        outcome: "Success",
        details: { totalRows: result.totalRows, succeededRows: result.succeededRows, failedRows: result.failedRows },
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
