import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SubmitStudioDraftRequestSchema } from "@nextbot/contracts";
import { handleSubmitStudioDraft } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/studio/drafts/:id/submit` (RBAC:
 * agent_platform=Write) — the Review step's own submit. Composes the full
 * `AgentDefinitionArtifact`, validates it through the SAME single validator
 * Text/Design mode use (`domain/artifact-validator.ts`), and lands the version
 * as `Draft` — never any other status (FR-AGT-13). Deletes the consumed
 * Studio draft on success.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SubmitStudioDraftRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Studio submit payload.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handleSubmitStudioDraft(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
