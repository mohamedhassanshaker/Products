import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateWidgetSessionRequestSchema, SandboxPreviewInvalidError } from "@nextbot/contracts";
import { handleCreateWidgetSession, type VerifiedSandboxPreview } from "@nextbot/conversations";
import { verifySandboxPreviewToken } from "@nextbot/iam";
import { corsHeaders, corsPreflightResponse } from "../../../../../src/lib/cors.js";
import { problemResponse } from "../../../../../src/lib/problem-response.js";
import { checkRateLimit } from "../../../../../src/lib/rate-limit.js";
import { rateLimitedResponse } from "../../../../../src/lib/rate-limit-response.js";
import { getClientIp } from "../../../../../src/lib/client-ip.js";

/** BE2 (QA fix pass): per-IP ceiling on this anonymous, pre-auth endpoint — 100/100
 * concurrent unauthenticated session-creates succeeded instantly pre-fix. Generous
 * for any real visitor (a widget mounts once per page load), blocks a naive flood. */
const SESSION_CREATE_LIMIT = 20;
const SESSION_CREATE_WINDOW_SECONDS = 60;

/** `POST /api/v1/widget/sessions` (LLD §5.3) — anonymous, CORS-checked. The very
 * first Gateway Plane HTTP surface (ADR-0004) — see this route's package README. */
export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(`widget-session:${getClientIp(request)}`, SESSION_CREATE_LIMIT, SESSION_CREATE_WINDOW_SECONDS);
  if (!rateLimit.allowed) return rateLimitedResponse(SESSION_CREATE_WINDOW_SECONDS);

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateWidgetSessionRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid widget session request.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  // Phase 6 (client-feedback-batch item 9), SECURITY-CRITICAL: this route is
  // otherwise fully anonymous/pre-auth (any real customer's page can call it), so a
  // `previewVersionId` on the request body must **never** be honored on its own —
  // this is the one and only place `@nextbot/conversations` (no allowed dependency on
  // `@nextbot/iam`, LLD §2.3) and `@nextbot/iam` are wired together, exactly because
  // this cross-cutting verification belongs at the composition root, not inside
  // either module. A missing/invalid/expired/wrong-version/wrong-tenant token is
  // rejected outright with a 403 below — it is never silently dropped in favor of an
  // ordinary anonymous session, which would defeat the whole point of gating it.
  let verifiedPreview: VerifiedSandboxPreview | undefined;
  if (body.previewVersionId) {
    if (!body.previewToken) {
      return NextResponse.json(
        { type: "about:blank", title: "Sandbox preview requires a valid admin session token.", status: 403, code: "SANDBOX_PREVIEW_INVALID" },
        { status: 403, headers: corsHeaders() },
      );
    }
    try {
      const claims = await verifySandboxPreviewToken(body.previewToken);
      if (claims.versionId !== body.previewVersionId) throw new SandboxPreviewInvalidError();
      verifiedPreview = { tenantId: claims.tenantId, versionId: claims.versionId };
    } catch (err) {
      return problemResponse(err instanceof SandboxPreviewInvalidError ? err : new SandboxPreviewInvalidError());
    }
  }

  try {
    const result = await handleCreateWidgetSession(body, verifiedPreview);
    return NextResponse.json(result, { status: 201, headers: corsHeaders() });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
