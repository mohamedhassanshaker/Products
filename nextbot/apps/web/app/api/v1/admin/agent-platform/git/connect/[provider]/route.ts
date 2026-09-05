import { NextResponse } from "next/server";
import { buildGitHubAuthorizeUrl, buildGitLabAuthorizeUrl } from "@nextbot/agent-platform";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/git/connect/:provider` (LLD §3.10a) — initiates
 * the OAuth/GitHub-App-installation redirect (RBAC: agent_platform=Write, since
 * connecting Git is a mutating admin action). */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { provider } = await params;
  // The redirect target is a real page (not this JSON API route) — the provider
  // redirects the browser here directly, so the user sees the "Finishing
  // connection…" loading screen and repo picker (UX_GUIDELINES.md §6.3), not a raw
  // JSON response. `provider` is passed through as a query param since GitHub/
  // GitLab's own callback redirect carries no path segment of our choosing.
  const redirectUri = new URL(`/settings/integrations/git-callback?provider=${provider}`, request.url).toString();
  const state = crypto.randomUUID();

  try {
    const redirectUrl = provider === "GitHub" ? buildGitHubAuthorizeUrl(redirectUri, state) : buildGitLabAuthorizeUrl(redirectUri, state);
    return NextResponse.json({ redirectUrl, state });
  } catch (err) {
    // Not-yet-configured OAuth app credentials (this sandboxed dev environment has
    // none — see the dispatch report) is a real, actionable operator-facing error,
    // not a generic 500.
    return NextResponse.json({ type: "about:blank", title: (err as Error).message, status: 501 }, { status: 501 });
  }
}
