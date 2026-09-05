import { NextResponse, type NextRequest } from "next/server";
import { handleGitWebhook } from "@nextbot/agent-platform";
import { resolveTenantById } from "@nextbot/tenancy";
import { checkRateLimit } from "../../../../../../../src/lib/rate-limit.js";
import { rateLimitedResponse } from "../../../../../../../src/lib/rate-limit-response.js";
import { problemResponse } from "../../../../../../../src/lib/problem-response.js";

/**
 * `POST /api/agent-platform/git/webhooks/:provider/:tenantId` (ADR-0009) — the
 * Gateway Plane's inbound webhook receiver for the tenant's connected GitHub/GitLab
 * remote, per ADR-0004's "all external ingress lives in the Gateway Plane" (the same
 * category as the widget's own public ingress). `tenantId` in the path is routing
 * only, never the security boundary — the actual authentication is the HMAC/shared-
 * token signature check inside `handleGitWebhook`, verified against this tenant's own
 * vaulted webhook secret.
 */
const WEBHOOK_LIMIT = 60;
const WEBHOOK_WINDOW_SECONDS = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string; tenantId: string }> }) {
  const { provider, tenantId } = await params;

  const rateLimit = await checkRateLimit(`git-webhook:${tenantId}`, WEBHOOK_LIMIT, WEBHOOK_WINDOW_SECONDS);
  if (!rateLimit.allowed) return rateLimitedResponse(WEBHOOK_WINDOW_SECONDS);

  if (provider !== "GitHub" && provider !== "GitLab") {
    return NextResponse.json({ type: "about:blank", title: "Unknown Git provider.", status: 404 }, { status: 404 });
  }

  const tenant = await resolveTenantById(tenantId);
  if (!tenant) {
    return NextResponse.json({ type: "about:blank", title: "Unknown tenant.", status: 404 }, { status: 404 });
  }
  const ctx = { tenantId: tenant.id, region: tenant.region, environment: "Sandbox" as const };

  const rawBody = await request.text();
  let payload: { number?: number; merged?: boolean; state?: string; pull_request?: { number: number; merged: boolean } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ type: "about:blank", title: "Invalid webhook payload.", status: 400 }, { status: 400 });
  }

  const prNumber = payload.pull_request?.number ?? payload.number;
  if (prNumber === undefined) {
    return NextResponse.json({ ok: true, ignored: "no PR/MR number in payload" });
  }
  const merged = payload.pull_request?.merged ?? payload.merged ?? false;
  const eventStatus: "Merged" | "Closed" | "Open" = merged ? "Merged" : payload.state === "closed" ? "Closed" : "Open";

  const signatureHeader = provider === "GitHub" ? request.headers.get("x-hub-signature-256") : request.headers.get("x-gitlab-token");

  try {
    await handleGitWebhook(ctx, { provider, rawBody, signatureHeader, prNumber, eventStatus });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("signature verification failed")) {
      return NextResponse.json({ type: "about:blank", title: "Invalid webhook signature.", status: 401 }, { status: 401 });
    }
    return problemResponse(err);
  }
}
