import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CsatCaptureRequestSchema } from "@nextbot/contracts";
import { returnToBot } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/escalations/{id}/return-to-bot` (RBAC: escalations=Write) —
 * FR-ESC-04. Phase 13 (BL-45, FR-ESC-05) addition: accepts the same optional CSAT
 * body `resolve` does — a takeover can end this way too, and capturing it here is
 * non-blocking exactly like `resolve` (see `resolveEscalation`'s doc comment).
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
    const escalation = await returnToBot(guard.ctx, id, guard.session.userId, csat);
    return NextResponse.json({ id: escalation.id, status: escalation.status, csatCapturedAt: escalation.csatCapturedAt });
  } catch (err) {
    return problemResponse(err);
  }
}
