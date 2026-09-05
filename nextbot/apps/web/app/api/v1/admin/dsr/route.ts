import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateDsrRequestSchema } from "@nextbot/contracts";
import { listDsrRequests } from "@nextbot/pii";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { exportDsrData, processDsrRequest } from "@/src/lib/dsr-service";

/** `GET/POST /api/v1/admin/dsr` (RBAC: security_settings, B.8.4's "Process Data
 * Subject Request" tool). `POST` with `requestType: "Delete"` is a genuinely
 * destructive, hard-to-reverse action — gated the same as every other Write-level
 * admin mutation (no separate confirmation step at the API layer; the UI's own
 * confirm dialog is the safety gate, matching this codebase's existing convention
 * for other destructive admin actions). */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ requests: await listDsrRequests(guard.ctx) });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateDsrRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid DSR request.", status: 422 }, { status: 422 });
  }

  try {
    if (body.requestType === "Export") {
      const data = await exportDsrData(guard.ctx, body.customerIdentifier);
      return NextResponse.json(data);
    }
    const { requestId, outcome } = await processDsrRequest(guard.ctx, body.requestType, body.customerIdentifier, guard.session.userId);
    return NextResponse.json({ requestId, outcome }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
