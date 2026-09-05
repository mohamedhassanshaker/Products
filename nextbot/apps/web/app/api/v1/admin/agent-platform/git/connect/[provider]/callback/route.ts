import { NextResponse, type NextRequest } from "next/server";
import { exchangeGitHubCode, exchangeGitLabCode, getGitProviderClient } from "@nextbot/agent-platform";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/git/connect/:provider/callback` (LLD §3.10a) —
 * exchanges the OAuth `code` for a real access token and lists the repos that token
 * can see, so the tenant admin can pick one. The token itself is returned to the
 * (already-authenticated, RBAC-gated) browser session only to be immediately re-POSTed
 * to `/git/connection` — it is never persisted by this route. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { provider } = await params;
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ type: "about:blank", title: "Missing OAuth 'code' parameter.", status: 422 }, { status: 422 });
  }
  // Must match exactly the redirect_uri used to build the authorize URL (see the
  // sibling `../route.ts`) — the page the provider actually redirects the browser
  // to, not this JSON API route itself.
  const redirectUri = new URL(`/settings/integrations/git-callback?provider=${provider}`, request.url).toString();

  try {
    const exchanged = provider === "GitHub" ? await exchangeGitHubCode(code, redirectUri) : await exchangeGitLabCode(code, redirectUri);
    const client = getGitProviderClient(provider === "GitHub" ? "GitHub" : "GitLab", { token: exchanged.accessToken });
    const repos = await client.listRepos();
    return NextResponse.json({ accessToken: exchanged.accessToken, refreshToken: "refreshToken" in exchanged ? exchanged.refreshToken : undefined, repos });
  } catch (err) {
    return NextResponse.json({ type: "about:blank", title: (err as Error).message, status: 502 }, { status: 502 });
  }
}
