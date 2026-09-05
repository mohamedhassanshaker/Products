import { NextResponse } from "next/server";
import { draftAiSuggestion } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/escalations/{id}/draft` (RBAC: escalations=Write) — FR-AI-08:
 * an AI-drafted reply the agent may accept as-is, edit, or discard. **Never sends** —
 * sending is a separate call to `.../messages`. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const draft = await draftAiSuggestion(guard.ctx, id);
    return NextResponse.json(draft);
  } catch (err) {
    return problemResponse(err);
  }
}
