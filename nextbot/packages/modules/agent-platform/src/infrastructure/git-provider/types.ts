import type { GitDiffFile } from "@nextbot/contracts";

/**
 * The provider-agnostic Git remote client (ADR-0009 / LLD §3.10a) — GitHub and GitLab
 * adapters below implement this against the real, documented REST APIs (never a local
 * clone, never shelled-out `git`, per ADR-0009's explicit rejection of that
 * alternative). `git-connection-service.ts` is the only caller.
 */
export interface GitProviderClient {
  listRepos(): Promise<Array<{ owner: string; name: string }>>;
  /** Reads a file's current content + provider-specific version marker (GitHub: blob
   * `sha`; GitLab: the file's `last_commit_id`) so `commitFile` can decide
   * create-vs-update. `null` when the file does not exist yet at `ref`. */
  getFile(params: { owner: string; repo: string; path: string; ref: string }): Promise<{ versionMarker: string; content: string } | null>;
  /**
   * BE1 fix (QA 2026-08-15 backend pass): idempotently ensures `branch` exists,
   * branching it off `fromBranch`'s current tip if it doesn't already — never
   * overwrites an existing branch. `commitAgentDefinitionVersion` calls this before
   * every commit so each agent-definition version lands on its **own** branch
   * (`agents/<agentDefinitionId>/<version>`) rather than directly on the tenant's
   * `defaultBranch`; this is what makes the subsequent `openPullRequest({head, base})`
   * call have a genuinely different head/base, which real GitHub/GitLab require
   * (both reject `head === base` with a 422/409 — "no commits between").
   */
  ensureBranch(params: { owner: string; repo: string; branch: string; fromBranch: string }): Promise<void>;
  commitFile(params: { owner: string; repo: string; path: string; content: string; message: string; branch: string }): Promise<{ commitSha: string }>;
  compare(params: { owner: string; repo: string; base: string; head: string }): Promise<{ files: GitDiffFile[] }>;
  openPullRequest(params: { owner: string; repo: string; title: string; body: string; head: string; base: string }): Promise<{ number: number }>;
  getPullRequestStatus(params: { owner: string; repo: string; number: number }): Promise<"Open" | "Merged" | "Closed">;
}

/** Thrown for any transport/HTTP-level failure talking to the tenant's Git provider —
 * distinct from `GitConnectionUnavailableError` (the domain-level, tenant-facing
 * error `git-connection-service.ts` raises once it decides the connection itself is
 * unreachable) so the service layer can tell "this one call failed" apart from
 * "mark the whole connection Unreachable". */
export class GitProviderTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GitProviderTransportError";
  }
}
