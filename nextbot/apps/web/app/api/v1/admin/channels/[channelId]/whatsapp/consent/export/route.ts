import { NextResponse, type NextRequest } from "next/server";
import { listConsentRecordDtos } from "@nextbot/channels";
import { requireApi } from "@/src/lib/api-guard";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { getSession } from "@/src/lib/session";

const EXPORT_LIMIT = 10;
const EXPORT_WINDOW_SECONDS = 60;

/** `GET /api/v1/admin/channels/:channelId/whatsapp/consent/export` — PII-masked CSV
 * export (§7.2.5), mirroring the Conversation List export's direct-CSV-response
 * pattern (rate-limited, RBAC-guarded) rather than the async-signed-URL shape LLD
 * §12.5 describes for Reporting specifically — no object-storage/signed-URL
 * infrastructure exists in this codebase yet, and every masked field here is
 * already safe to return directly (never plaintext PII). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const session = await getSession();
  const rateLimit = await checkRateLimit(`whatsapp-consent-export:${session?.userId ?? guard.ctx.tenantId}`, EXPORT_LIMIT, EXPORT_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { type: "about:blank", title: "Too many export requests — please wait a minute and try again.", status: 429 },
      { status: 429, headers: { "Retry-After": String(EXPORT_WINDOW_SECONDS) } },
    );
  }

  const records = await listConsentRecordDtos(guard.ctx, channelId);
  const header = "customer_identifier_masked,state,source,recorded_at";
  const lines = records.map((r) => `${r.customerIdentifierMasked},${r.state},${r.source},${r.recordedAt}`);
  const csv = [header, ...lines].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=whatsapp-consent-export.csv" },
  });
}
