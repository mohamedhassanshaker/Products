import type { GitDiffFile } from "@nextbot/contracts";
import { GitProviderTransportError, type GitProviderClient } from "./types.js";

/**
 * GitLab REST API v4 client (ADR-0009 §2) — including self-hosted GitLab via
 * `opts.baseUrl` (ADR-0009's explicit requirement: "self-hosted GitLab is supported
 * via a tenant-supplied base URL"). Plain `fetch`, same rationale as the GitHub client.
 */
export function createGitLabClient(opts: { token: string; baseUrl?: string }): GitProviderClient {
  const apiBase = `${(opts.baseUrl ?? "https://gitlab.com").replace(/\/$/, "")}/api/v4`;

  async function gl<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch (cause) {
      throw new GitProviderTransportError(`GitLab API ${init?.method ?? "GET"} ${path} failed: ${(cause as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GitProviderTransportError(`GitLab API ${init?.method ?? "GET"} ${path} failed with status ${response.status}: ${detail.slice(0, 500)}`, response.status);
    }
    return response.json() as Promise<T>;
  }

  function projectId(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  return {
    async listRepos() {
      const projects = await gl<Array<{ path_with_namespace: string }>>("/projects?membership=true&per_page=100");
      return projects.map((p) => {
        const [owner, ...rest] = p.path_with_namespace.split("/");
        return { owner: owner ?? "", name: rest.join("/") };
      });
    },

    async getFile({ owner, repo, path, ref }) {
      try {
        const file = await gl<{ content: string; encoding: string; last_commit_id: string }>(
          `/projects/${projectId(owner, repo)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
        );
        const content = file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
        return { versionMarker: file.last_commit_id, content };
      } catch (err) {
        if (err instanceof GitProviderTransportError && err.status === 404) return null;
        throw err;
      }
    },

    async ensureBranch({ owner, repo, branch, fromBranch }) {
      // Idempotent — see github-client.ts's `ensureBranch` doc comment for the full
      // rationale (BE1 fix). GitLab's "get a single repository branch" 404s if it
      // doesn't exist yet, which is exactly the create-vs-noop signal needed here.
      try {
        await gl(`/projects/${projectId(owner, repo)}/repository/branches/${encodeURIComponent(branch)}`);
        return;
      } catch (err) {
        if (!(err instanceof GitProviderTransportError && err.status === 404)) throw err;
      }
      await gl(`/projects/${projectId(owner, repo)}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(fromBranch)}`, {
        method: "POST",
      });
    },

    async commitFile({ owner, repo, path, content, message, branch }) {
      const existing = await this.getFile({ owner, repo, path, ref: branch }).catch(() => null);
      const result = await gl<{ id: string }>(`/projects/${projectId(owner, repo)}/repository/commits`, {
        method: "POST",
        body: JSON.stringify({
          branch,
          commit_message: message,
          actions: [{ action: existing ? "update" : "create", file_path: path, content }],
        }),
      });
      return { commitSha: result.id };
    },

    async compare({ owner, repo, base, head }) {
      const result = await gl<{ diffs?: Array<{ old_path: string; new_path: string; diff: string }> }>(
        `/projects/${projectId(owner, repo)}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`,
      );
      const files: GitDiffFile[] = (result.diffs ?? []).map((d) => {
        const additions = (d.diff.match(/^\+(?!\+\+)/gm) ?? []).length;
        const deletions = (d.diff.match(/^-(?!--)/gm) ?? []).length;
        return { path: d.new_path || d.old_path, patch: d.diff, additions, deletions };
      });
      return { files };
    },

    async openPullRequest({ owner, repo, title, body, head, base }) {
      const result = await gl<{ iid: number }>(`/projects/${projectId(owner, repo)}/merge_requests`, {
        method: "POST",
        body: JSON.stringify({ title, description: body, source_branch: head, target_branch: base }),
      });
      return { number: result.iid };
    },

    async getPullRequestStatus({ owner, repo, number }) {
      const result = await gl<{ state: "opened" | "closed" | "merged" | "locked" }>(`/projects/${projectId(owner, repo)}/merge_requests/${number}`);
      if (result.state === "merged") return "Merged";
      return result.state === "opened" ? "Open" : "Closed";
    },
  };
}
