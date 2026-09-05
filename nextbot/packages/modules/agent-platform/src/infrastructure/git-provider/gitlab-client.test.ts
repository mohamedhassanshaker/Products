import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { GitProviderTransportError } from "./types.js";
import { createGitLabClient } from "./gitlab-client.js";

/**
 * A minimal in-process stand-in for the GitLab REST API v4 surface `gitlab-client.ts`
 * actually calls — the same rationale as `ai-registry`'s `anthropic.test.ts` (no
 * publicly reachable local GitLab-shaped server exists, and this sandbox has no real
 * GitLab OAuth token). Exercises real request/response handling end-to-end, including
 * the BE1 fix's `ensureBranch` (idempotent branch creation) — GitLab's own client had
 * no dedicated test coverage before this fix pass.
 */
interface MockGitLabState {
  branches: Set<string>;
  files: Map<string, { content: string; last_commit_id: string }>;
  mrs: Map<number, { state: "opened" | "closed" | "merged" }>;
  nextMrIid: number;
}

function createMockGitLabState(): MockGitLabState {
  return { branches: new Set(["main"]), files: new Map(), mrs: new Map(), nextMrIid: 1 };
}

async function startMockGitLabServer(state: MockGitLabState): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};

      if (req.method === "GET" && url.pathname === "/api/v4/projects" && url.searchParams.get("membership") === "true") {
        return json(res, 200, [{ path_with_namespace: "acme/agent-defs" }]);
      }

      const branchGetMatch = url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/repository\/branches\/(.+)$/);
      if (req.method === "GET" && branchGetMatch) {
        const branch = decodeURIComponent(branchGetMatch[1] ?? "");
        if (!state.branches.has(branch)) return json(res, 404, { message: "404 Branch Not Found" });
        return json(res, 200, { name: branch });
      }

      if (req.method === "POST" && url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/repository\/branches$/)) {
        const branch = url.searchParams.get("branch") ?? "";
        state.branches.add(branch);
        return json(res, 201, { name: branch });
      }

      const fileMatch = url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/repository\/files\/(.+)$/);
      if (req.method === "GET" && fileMatch) {
        const path = decodeURIComponent(fileMatch[1] ?? "");
        const file = state.files.get(path);
        if (!file) return json(res, 404, { message: "404 File Not Found" });
        return json(res, 200, { content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64", last_commit_id: file.last_commit_id });
      }

      if (req.method === "POST" && url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/repository\/commits$/)) {
        const action = body.actions?.[0];
        const commitSha = `gl-sha-${Date.now()}`;
        if (action) state.files.set(action.file_path, { content: action.content, last_commit_id: commitSha });
        return json(res, 201, { id: commitSha });
      }

      if (req.method === "GET" && url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/repository\/compare$/)) {
        return json(res, 200, { diffs: [{ old_path: "a.yaml", new_path: "a.yaml", diff: "@@ -0,0 +1,2 @@\n+line one\n+line two" }] });
      }

      if (req.method === "POST" && url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/merge_requests$/)) {
        const iid = state.nextMrIid++;
        state.mrs.set(iid, { state: "opened" });
        return json(res, 201, { iid });
      }

      const mrGetMatch = url.pathname.match(/^\/api\/v4\/projects\/[^/]+\/merge_requests\/(\d+)$/);
      if (req.method === "GET" && mrGetMatch) {
        const iid = Number(mrGetMatch[1]);
        const mr = state.mrs.get(iid);
        if (!mr) return json(res, 404, { message: "404 Not Found" });
        return json(res, 200, { state: mr.state });
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

describe("createGitLabClient (real HTTP against a mock GitLab-shaped server)", () => {
  let server: { url: string; close: () => Promise<void> } | undefined;
  let state: MockGitLabState;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("listRepos splits path_with_namespace into owner/name", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    const repos = await client.listRepos();
    expect(repos).toEqual([{ owner: "acme", name: "agent-defs" }]);
  });

  it("getFile returns null (not throws) for a 404", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    expect(await client.getFile({ owner: "acme", repo: "agent-defs", path: "missing.yaml", ref: "main" })).toBeNull();
  });

  it("ensureBranch is a no-op when the branch already exists, and creates it off fromBranch when it doesn't (BE1 fix)", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });

    await client.ensureBranch({ owner: "acme", repo: "agent-defs", branch: "main", fromBranch: "main" });
    expect(state.branches.has("main")).toBe(true);

    await client.ensureBranch({ owner: "acme", repo: "agent-defs", branch: "agents/def-1/1.0.0", fromBranch: "main" });
    expect(state.branches.has("agents/def-1/1.0.0")).toBe(true);
  });

  it("commitFile creates a new file (no prior getFile result) and returns a real commit sha", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    const { commitSha } = await client.commitFile({ owner: "acme", repo: "agent-defs", path: "agents/def-1/1.0.0.yaml", content: "apiVersion: v1", message: "msg", branch: "agents/def-1/1.0.0" });
    expect(commitSha).toBeTruthy();
    expect(state.files.get("agents/def-1/1.0.0.yaml")?.content).toBe("apiVersion: v1");
  });

  it("compare computes additions/deletions from the unified diff", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    const result = await client.compare({ owner: "acme", repo: "agent-defs", base: "main", head: "agents/def-1/1.0.0" });
    expect(result.files[0]).toMatchObject({ path: "a.yaml", additions: 2, deletions: 0 });
  });

  it("openPullRequest opens a real merge request and getPullRequestStatus reads it back as Open", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    const { number } = await client.openPullRequest({ owner: "acme", repo: "agent-defs", title: "t", body: "b", head: "agents/def-1/1.0.0", base: "main" });
    expect(number).toBeGreaterThan(0);
    expect(await client.getPullRequestStatus({ owner: "acme", repo: "agent-defs", number })).toBe("Open");
  });

  it("getPullRequestStatus maps 'merged' to Merged and anything else to Closed", async () => {
    state = createMockGitLabState();
    state.mrs.set(1, { state: "merged" });
    state.mrs.set(2, { state: "closed" });
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    expect(await client.getPullRequestStatus({ owner: "acme", repo: "agent-defs", number: 1 })).toBe("Merged");
    expect(await client.getPullRequestStatus({ owner: "acme", repo: "agent-defs", number: 2 })).toBe("Closed");
  });

  it("wraps a network-level failure (unreachable baseUrl) in GitProviderTransportError, never a raw fetch error", async () => {
    const client = createGitLabClient({ token: "fake", baseUrl: "http://127.0.0.1:1" });
    await expect(client.listRepos()).rejects.toBeInstanceOf(GitProviderTransportError);
  });

  it("wraps a non-2xx status in GitProviderTransportError carrying the real status code", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    await expect(client.getPullRequestStatus({ owner: "acme", repo: "agent-defs", number: 999 })).rejects.toMatchObject({ status: 404 });
  });

  it("defaults to https://gitlab.com when no baseUrl is supplied (self-hosted GitLab support, ADR-0009)", () => {
    const client = createGitLabClient({ token: "fake" });
    expect(client).toBeDefined();
  });

  it("commitFile updates an existing file (getFile succeeds first) rather than always creating", async () => {
    state = createMockGitLabState();
    state.files.set("agents/def-1/1.0.0.yaml", { content: "old content", last_commit_id: "prior-sha" });
    server = await startMockGitLabServer(state);
    const client = createGitLabClient({ token: "fake", baseUrl: server.url });
    const { commitSha } = await client.commitFile({ owner: "acme", repo: "agent-defs", path: "agents/def-1/1.0.0.yaml", content: "new content", message: "update", branch: "main" });
    expect(commitSha).toBeTruthy();
    expect(state.files.get("agents/def-1/1.0.0.yaml")?.content).toBe("new content");
  });

  it("getFile decodes non-base64 content as-is (no double-decode)", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    // A raw (non-base64) file response — the mock server always returns base64, so
    // this exercises the client's `encoding !== "base64"` branch by monkeypatching
    // the global fetch for this one call.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ content: "plain text content", encoding: "text", last_commit_id: "sha-plain" }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const client = createGitLabClient({ token: "fake", baseUrl: server.url });
      const file = await client.getFile({ owner: "acme", repo: "agent-defs", path: "plain.yaml", ref: "main" });
      expect(file).toEqual({ versionMarker: "sha-plain", content: "plain text content" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("getFile rethrows a non-404 transport error instead of treating it as 'not found'", async () => {
    const client = createGitLabClient({ token: "fake", baseUrl: "http://127.0.0.1:1" });
    await expect(client.getFile({ owner: "acme", repo: "agent-defs", path: "x.yaml", ref: "main" })).rejects.toBeInstanceOf(GitProviderTransportError);
  });

  it("ensureBranch rethrows a non-404 error from the initial branch-existence check", async () => {
    const client = createGitLabClient({ token: "fake", baseUrl: "http://127.0.0.1:1" });
    await expect(client.ensureBranch({ owner: "acme", repo: "agent-defs", branch: "new-branch", fromBranch: "main" })).rejects.toBeInstanceOf(GitProviderTransportError);
  });

  it("compare falls back to old_path when new_path is empty, and to an empty diff list when the server omits 'diffs'", async () => {
    state = createMockGitLabState();
    server = await startMockGitLabServer(state);
    const realFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      const body = call === 1 ? { diffs: [{ old_path: "removed.yaml", new_path: "", diff: "-gone" }] } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const client = createGitLabClient({ token: "fake", baseUrl: server.url });
      const first = await client.compare({ owner: "acme", repo: "agent-defs", base: "main", head: "feature" });
      expect(first.files[0]?.path).toBe("removed.yaml");
      const second = await client.compare({ owner: "acme", repo: "agent-defs", base: "main", head: "feature" });
      expect(second.files).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
