import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CsatCaptureRequestSchema } from "@nextbot/contracts";
import { resolveEscalation } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/escalations/{id}/resolve` (RBAC: escalations=Write) — B.5.2's
 * "Resolve & Close". Phase 13 (BL-45, FR-ESC-05) addition: an optional CSAT body
 * (`csatScore` 1-5, `csatComment`) — a missing/empty body is still a perfectly valid
 * request (CSAT never blocks the close), so an invalid/malformed body other than
 * "absent" is the only thing rejected here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const rawBody = await request.json().catch(() => null);
  let csat: { csatScore?: number; csatComment?: string } | undefined;
  if (rawBody !== null) {
    if (!Value.Check(CsatCaptureRequestSchema, rawBody)) {
      return NextResponse.json({ type: "about:blank", title: "Invalid CSAT payload.", status: 422 }, { status: 422 });
    }
    csat = rawBody;
  }

  try {
    const escalation = await resolveEscalation(guard.ctx, id, guard.session.userId, csat);
    return NextResponse.json({ id: escalation.id, status: escalation.status, csatCapturedAt: escalation.csatCapturedAt });
  } catch (err) {
    return problemResponse(err);
  }
}
