import { createServer, type Server, type ServerResponse } from "node:http";

/**
 * A minimal in-process stand-in for the GitHub REST API v3 surface
 * `packages/modules/agent-platform`'s `github-client.ts` actually calls (contents,
 * refs/branches, compare, pulls) — proving that adapter's real request/response
 * handling end-to-end without a live GitHub App/OAuth token, the same rationale as
 * `startMockMcpServer`/`startMockOpenAiCompatibleServer`. Also usable as a
 * GitHub-Enterprise-Server-shaped `baseUrl` target, since this codebase's client
 * treats `baseUrl` identically for both cases (just a different `api.github.com` vs.
 * enterprise API root).
 *
 * **BE1 fix (QA 2026-08-15 backend pass, BLOCKING).** This state/server used to be
 * branch-oblivious (a single flat `path -> content` map, and `POST .../pulls`
 * unconditionally returned 201 regardless of `head`/`base`) — which is exactly why
 * `commitAgentDefinitionVersion` committing straight onto `defaultBranch` and
 * `openAgentDefinitionReview` opening a PR with `head === base` both passed dev's own
 * tests despite being rejected by real GitHub (422 "No commits between main and
 * main") and GitLab (409) alike. Fixed here to be genuinely branch-aware (files are
 * keyed by `${branch}:${path}`, branches are real refs with their own tip sha) and to
 * reject a same-head/base PR the same way GitHub's real API does, so this class of
 * bug can't silently slip through this mock again.
 */
export interface MockGitHubState {
  /** Keyed by `${branch}:${path}` — branch-aware so a base and head branch can
   * genuinely carry different content, the same way a real repo would. */
  files: Map<string, { sha: string; content: string }>;
  /** branch name -> the sha of its current tip commit (a real git ref). */
  branches: Map<string, string>;
  pulls: Map<number, { state: "open" | "closed"; merged: boolean; head: string; base: string }>;
  nextPrNumber: number;
}

export function createMockGitHubState(): MockGitHubState {
  return { files: new Map(), branches: new Map([["main", "sha-main-0"]]), pulls: new Map(), nextPrNumber: 1 };
}

export async function startMockGitHubServer(state: MockGitHubState): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};

      // GET /user/repos
      if (req.method === "GET" && url.pathname === "/user/repos") {
        return json(res, 200, [{ owner: { login: "acme" }, name: "agent-defs" }]);
      }

      // GET /repos/:owner/:repo/git/ref/heads/:branch — read a branch's current tip.
      const refGetMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/(.+)$/);
      if (req.method === "GET" && refGetMatch) {
        const branch = decodeURIComponent(refGetMatch[3] ?? "");
        const sha = state.branches.get(branch);
        if (!sha) return json(res, 404, { message: "Not Found" });
        return json(res, 200, { ref: `refs/heads/${branch}`, object: { sha } });
      }

      // POST /repos/:owner/:repo/git/refs — create a new branch (BE1 fix: this is
      // what `ensureBranch` calls before a version's first commit).
      const refsCreateMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/);
      if (req.method === "POST" && refsCreateMatch) {
        const branch = String(body.ref ?? "").replace(/^refs\/heads\//, "");
        if (!branch) return json(res, 422, { message: "Validation Failed" });
        if (state.branches.has(branch)) {
          // Real GitHub: "Reference already exists" — `ensureBranch` is expected to
          // check first (GET) and only reach here for a genuinely new branch, but this
          // mock still enforces the real rejection so a caller that skips the check
          // can't silently succeed.
          return json(res, 422, { message: "Reference already exists" });
        }
        state.branches.set(branch, body.sha);
        return json(res, 201, { ref: `refs/heads/${branch}`, object: { sha: body.sha } });
      }

      // GET/PUT /repos/:owner/:repo/contents/:path — branch-aware via `?ref=` (GET)
      // / `body.branch` (PUT).
      const contentsMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
      if (contentsMatch) {
        const path = decodeURIComponent(contentsMatch[3] ?? "");
        if (req.method === "GET") {
          const branch = url.searchParams.get("ref") ?? "main";
          const file = state.files.get(`${branch}:${path}`);
          if (!file) return json(res, 404, { message: "Not Found" });
          return json(res, 200, { sha: file.sha, content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64" });
        }
        if (req.method === "PUT") {
          const branch = body.branch ?? "main";
          const content = Buffer.from(body.content, "base64").toString("utf8");
          const sha = `sha-${state.files.size + 1}-${Date.now()}`;
          state.files.set(`${branch}:${path}`, { sha, content });
          // Committing to a branch advances its tip — mirrors real git so a
          // subsequent `ensureBranch`/compare/PR against this branch sees the new sha.
          state.branches.set(branch, sha);
          return json(res, 200, { commit: { sha } });
        }
      }

      // GET /repos/:owner/:repo/compare/:base...:head
      const compareMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/compare\/(.+)$/);
      if (req.method === "GET" && compareMatch) {
        return json(res, 200, { files: [{ filename: "agents/test/1.0.0.yaml", patch: "@@ -0,0 +1 @@\n+hello", additions: 1, deletions: 0 }] });
      }

      // POST /repos/:owner/:repo/pulls — BE1 fix: real GitHub rejects `head === base`
      // with a 422 "no commits between" style body; this mock now does too, instead
      // of unconditionally returning 201 regardless of the payload.
      const pullsCreateMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/);
      if (req.method === "POST" && pullsCreateMatch) {
        const head = String(body.head ?? "");
        const base = String(body.base ?? "");
        if (head === base) {
          return json(res, 422, {
            message: "Validation Failed",
            errors: [{ resource: "PullRequest", field: "base", code: "custom", message: `No commits between ${base} and ${head}` }],
          });
        }
        const number = state.nextPrNumber++;
        state.pulls.set(number, { state: "open", merged: false, head, base });
        return json(res, 201, { number });
      }

      // GET /repos/:owner/:repo/pulls/:number
      const pullsGetMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
      if (req.method === "GET" && pullsGetMatch) {
        const number = Number(pullsGetMatch[3]);
        const pr = state.pulls.get(number);
        if (!pr) return json(res, 404, { message: "Not Found" });
        return json(res, 200, { state: pr.state, merged: pr.merged });
      }

      json(res, 404, { message: "no route" });
    });
  });

  function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))) };
}
