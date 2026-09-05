import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * OAuth app / GitHub App credentials for the tenant Git-connect flow (ADR-0009 §2).
 * **Documented, env-configurable placeholders** — this sandboxed dev environment has
 * no real GitHub App / GitLab OAuth application registered (that requires an operator
 * to actually create one in GitHub/GitLab's own developer settings and put the
 * resulting client id/secret here), but the redirect/token-exchange protocol code
 * below is implemented against the real, documented OAuth endpoints, not stubbed —
 * pointing these env vars at a real registered app is the only thing needed to go live.
 *
 * | Var | Purpose |
 * |---|---|
 * | `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | GitHub App (or OAuth App) credentials for the "Connect GitHub" flow |
 * | `GITLAB_OAUTH_CLIENT_ID` / `GITLAB_OAUTH_CLIENT_SECRET` | GitLab OAuth application credentials |
 * | `GITLAB_OAUTH_BASE_URL` | Optional — self-hosted GitLab instance base URL for the OAuth authorize/token endpoints (ADR-0009: "self-hosted GitLab is supported via a tenant-supplied base URL"); defaults to `https://gitlab.com` |
 */
const EnvSchema = Type.Object({
  GITHUB_APP_CLIENT_ID: Type.Optional(Type.String()),
  GITHUB_APP_CLIENT_SECRET: Type.Optional(Type.String()),
  GITLAB_OAUTH_CLIENT_ID: Type.Optional(Type.String()),
  GITLAB_OAUTH_CLIENT_SECRET: Type.Optional(Type.String()),
  GITLAB_OAUTH_BASE_URL: Type.Optional(Type.String()),
});
export type GitOAuthEnv = Static<typeof EnvSchema>;

export function loadGitOAuthEnv(): GitOAuthEnv {
  const raw = {
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    GITLAB_OAUTH_CLIENT_ID: process.env.GITLAB_OAUTH_CLIENT_ID,
    GITLAB_OAUTH_CLIENT_SECRET: process.env.GITLAB_OAUTH_CLIENT_SECRET,
    GITLAB_OAUTH_BASE_URL: process.env.GITLAB_OAUTH_BASE_URL,
  };
  if (!Value.Check(EnvSchema, raw)) throw new Error("Invalid Git OAuth environment configuration.");
  return raw;
}

export function buildGitHubAuthorizeUrl(redirectUri: string, state: string): string {
  const env = loadGitOAuthEnv();
  if (!env.GITHUB_APP_CLIENT_ID) throw new Error("GITHUB_APP_CLIENT_ID is not configured — register a GitHub App/OAuth App first.");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "repo");
  return url.toString();
}

export function buildGitLabAuthorizeUrl(redirectUri: string, state: string): string {
  const env = loadGitOAuthEnv();
  if (!env.GITLAB_OAUTH_CLIENT_ID) throw new Error("GITLAB_OAUTH_CLIENT_ID is not configured — register a GitLab OAuth application first.");
  const url = new URL("/oauth/authorize", env.GITLAB_OAUTH_BASE_URL ?? "https://gitlab.com");
  url.searchParams.set("client_id", env.GITLAB_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "api");
  return url.toString();
}

export async function exchangeGitHubCode(code: string, redirectUri: string, tokenUrlOverride?: string): Promise<{ accessToken: string }> {
  const env = loadGitOAuthEnv();
  const response = await fetch(tokenUrlOverride ?? "https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  });
  if (!response.ok) throw new Error(`GitHub OAuth token exchange failed with status ${response.status}`);
  const json = (await response.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`GitHub OAuth token exchange failed: ${json.error ?? "no access_token returned"}`);
  return { accessToken: json.access_token };
}

export async function exchangeGitLabCode(code: string, redirectUri: string, tokenUrlOverride?: string): Promise<{ accessToken: string; refreshToken?: string }> {
  const env = loadGitOAuthEnv();
  const base = tokenUrlOverride ?? new URL("/oauth/token", env.GITLAB_OAUTH_BASE_URL ?? "https://gitlab.com").toString();
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITLAB_OAUTH_CLIENT_ID,
      client_secret: env.GITLAB_OAUTH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`GitLab OAuth token exchange failed with status ${response.status}`);
  const json = (await response.json()) as { access_token?: string; refresh_token?: string; error?: string };
  if (!json.access_token) throw new Error(`GitLab OAuth token exchange failed: ${json.error ?? "no access_token returned"}`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}
