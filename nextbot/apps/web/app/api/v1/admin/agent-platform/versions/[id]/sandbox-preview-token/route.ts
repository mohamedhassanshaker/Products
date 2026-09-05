import { NextResponse, type NextRequest } from "next/server";
import { handleGetVersion } from "@nextbot/agent-platform";
import { issueSandboxPreviewToken } from "@nextbot/iam";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/versions/:id/sandbox-preview-token`
 * (RBAC: agent_platform=Write) — Phase 6 (client-feedback-batch item 9).
 *
 * Mints the short-lived, signed authorization `ChatPreviewPanel.tsx` threads through
 * the widget iframe's config so the "test in sandbox before promoting" preview can
 * prove to the Gateway Plane's otherwise-anonymous widget session endpoint that a
 * real, permitted Admin Console operator (not a random visitor who found the query
 * parameter) requested this exact version's preview.
 *
 * `requireApi` already re-derives the caller's permissions from their real, verified
 * `nb_session` cookie (never trusts anything client-supplied) and 401/403s before
 * this handler's body runs at all. `handleGetVersion` additionally confirms
 * `versionId` genuinely belongs to *this* caller's tenant (RLS-scoped — a version id
 * for a different tenant 404s here, exactly like every other `/versions/:id` route),
 * so the token this mints can never name a version outside the issuing tenant.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    // Confirms the version exists and belongs to this tenant before minting a token
    // that names it — discarding the body itself, since only the existence/ownership
    // check matters here.
    await handleGetVersion(guard.ctx, id, guard.session.userId);
    const previewToken = await issueSandboxPreviewToken(guard.ctx.tenantId, guard.session.userId, id);
    return NextResponse.json({ previewToken, versionId: id, expiresInSeconds: 15 * 60 });
  } catch (err) {
    return problemResponse(err);
  }
}
