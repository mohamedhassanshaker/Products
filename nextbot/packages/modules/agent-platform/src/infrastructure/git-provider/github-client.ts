import type { GitDiffFile } from "@nextbot/contracts";
import { GitProviderTransportError, type GitProviderClient } from "./types.js";

/**
 * GitHub REST API v3 client (ADR-0009 §2). Plain `fetch` against `api.github.com` (or
 * a GitHub Enterprise Server `baseUrl`) — no `octokit` dependency: the surface this
 * product needs (contents, compare, pulls) is five stable, well-documented endpoints,
 * and avoiding the SDK keeps this adapter's behavior fully explicit and easy to point
 * at a mock server in tests (the same rationale as `openai-compatible.ts`).
 */
export function createGitHubClient(opts: { token: string; baseUrl?: string }): GitProviderClient {
  const apiBase = (opts.baseUrl ?? "https://api.github.com").replace(/\/$/, "");

  async function gh<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${opts.token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (cause) {
      // A network-level failure (DNS, connection refused, TLS) — never let this
      // surface as a raw, unwrapped `TypeError` from `fetch`; the caller (LLD §3.10a's
      // health check) needs a `GitProviderTransportError` specifically to decide
      // whether to mark the connection `Unreachable`.
      throw new GitProviderTransportError(`GitHub API ${init?.method ?? "GET"} ${path} failed: ${(cause as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GitProviderTransportError(`GitHub API ${init?.method ?? "GET"} ${path} failed with status ${response.status}: ${detail.slice(0, 500)}`, response.status);
    }
    return response.json() as Promise<T>;
  }

  return {
    async listRepos() {
      const repos = await gh<Array<{ owner: { login: string }; name: string }>>("/user/repos?per_page=100");
      return repos.map((r) => ({ owner: r.owner.login, name: r.name }));
    },

    async getFile({ owner, repo, path, ref }) {
      try {
        const file = await gh<{ sha: string; content: string; encoding: string }>(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        const content = file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
        return { versionMarker: file.sha, content };
      } catch (err) {
        if (err instanceof GitProviderTransportError && err.status === 404) return null;
        throw err;
      }
    },

    async ensureBranch({ owner, repo, branch, fromBranch }) {
      // Idempotent: if `branch` already has a ref, there is nothing to do — re-
      // committing a follow-up change to the same agent-definition version (rare, but
      // not disallowed) must never fail with GitHub's "Reference already exists" 422.
      try {
        await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
        return;
      } catch (err) {
        if (!(err instanceof GitProviderTransportError && err.status === 404)) throw err;
      }
      const base = await gh<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`);
      await gh(`/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
      });
    },

    async commitFile({ owner, repo, path, content, message, branch }) {
      const existing = await this.getFile({ owner, repo, path, ref: branch }).catch(() => null);
      const result = await gh<{ commit: { sha: string } }>(`/repos/${owner}/${repo}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch,
          ...(existing ? { sha: existing.versionMarker } : {}),
        }),
      });
      return { commitSha: result.commit.sha };
    },

    async compare({ owner, repo, base, head }) {
      const result = await gh<{ files?: Array<{ filename: string; patch?: string; additions: number; deletions: number }> }>(
        `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      );
      const files: GitDiffFile[] = (result.files ?? []).map((f) => ({ path: f.filename, patch: f.patch ?? "", additions: f.additions, deletions: f.deletions }));
      return { files };
    },

    async openPullRequest({ owner, repo, title, body, head, base }) {
      const result = await gh<{ number: number }>(`/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({ title, body, head, base }),
      });
      return { number: result.number };
    },

    async getPullRequestStatus({ owner, repo, number }) {
      const result = await gh<{ state: "open" | "closed"; merged: boolean }>(`/repos/${owner}/${repo}/pulls/${number}`);
      if (result.merged) return "Merged";
      return result.state === "open" ? "Open" : "Closed";
    },
  };
}
