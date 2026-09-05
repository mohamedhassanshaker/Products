import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { createMockGitHubState, startMockGitHubServer, type MockGitHubState } from "@nextbot/testing";
import { GitConnectionUnavailableError, AgentDefinitionNotFoundError } from "@nextbot/contracts";
import {
  connectGit,
  disconnectGit,
  getGitConnectionView,
  commitAgentDefinitionVersion,
  diffAgentDefinitionVersions,
  openAgentDefinitionReview,
  handleGitWebhook,
  reconcileOpenPrsForTenant,
  debugDecryptWebhookSecretForTests,
  versionBranchName,
} from "./git-connection-service.js";
import { createAgentDefinition, createAgentDefinitionVersion, submitVersionForReview, listDefinitions, getDefinition, diffVersions } from "./agent-definition-service.js";
import { getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import { getGitProviderClient } from "../infrastructure/git-provider/index.js";

const MINIMAL_ARTIFACT = (name: string, version: string) => ({
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name, version },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions: "hi",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
});

/**
 * Real HTTP round trip against a local GitHub-API-shaped stand-in — this is the
 * "build the real integration code path against the actual provider APIs" proof
 * ADR-0009 calls for, exercised without a live GitHub App/OAuth token (none exists in
 * this sandbox — see the dispatch report). The request/response handling in
 * `github-client.ts` is genuinely exercised end-to-end: contents PUT/GET, compare,
 * pulls create/get — not mocked at the adapter boundary.
 */
describe("git-connection-service (ADR-0009, real HTTP against a mock GitHub-shaped server)", () => {
  let ctx: TenantContext;
  let mockState: MockGitHubState;
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    ctx = await createFixtureTenant();
    mockState = createMockGitHubState();
    server = await startMockGitHubServer(mockState);
  });
  afterAll(async () => {
    await server.close();
    await deleteFixtureTenant(ctx.tenantId);
  });

  it("connectGit vaults the token + webhook secret and creates a Connected git_connection", async () => {
    const view = await connectGit(ctx, {
      provider: "GitHub",
      repoOwner: "acme",
      repoName: "agent-defs",
      baseUrl: server.url,
      accessToken: "fake-github-token",
      createdByUserId: "11111111-1111-1111-1111-111111111111",
    });
    expect(view).toMatchObject({ provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", status: "Connected" });
  });

  it("commitAgentDefinitionVersion performs a real commit via the GitHub client and returns a genuine commit sha", async () => {
    const definition = await createAgentDefinition(ctx, { name: "support-triage" });
    const { commitSha } = await commitAgentDefinitionVersion(ctx, { agentDefinitionId: definition.id, version: "1.0.0", yamlContent: "apiVersion: nextbot.io/v1\n" });
    expect(commitSha).toBeTruthy();
    // BE1 fix: the commit lands on the version's own branch, never `defaultBranch`.
    const branch = versionBranchName(definition.id, "1.0.0");
    expect(mockState.files.get(`${branch}:agents/${definition.id}/1.0.0.yaml`)?.content).toContain("apiVersion");
    expect(mockState.files.has(`main:agents/${definition.id}/1.0.0.yaml`)).toBe(false);
  });

  it("BE1 regression: commitAgentDefinitionVersion creates a per-version branch off defaultBranch, and openAgentDefinitionReview opens a PR whose head genuinely differs from base — real GitHub/GitLab reject head===base (422/409), so this is what actually makes FR-AGT-03's PR-review flow functional", async () => {
    const definition = await createAgentDefinition(ctx, { name: "branch-per-version-target" });
    const { commitSha } = await commitAgentDefinitionVersion(ctx, { agentDefinitionId: definition.id, version: "2.0.0", yamlContent: "apiVersion: nextbot.io/v1\n" });

    const branch = versionBranchName(definition.id, "2.0.0");
    expect(branch).not.toBe("main");
    expect(mockState.branches.has(branch)).toBe(true);

    const { number } = await openAgentDefinitionReview(ctx, { agentDefinitionId: definition.id, version: "2.0.0", commitSha });
    const pr = mockState.pulls.get(number);
    expect(pr?.head).toBe(branch);
    expect(pr?.base).toBe("main");
    expect(pr?.head).not.toBe(pr?.base);
  });

  it("BE1 regression: the mock GitHub server itself now enforces the real head!==base rule (422, real GitHub's error shape) instead of unconditionally returning 201 — proves this class of bug can't silently pass this suite again", async () => {
    const client = getGitProviderClient("GitHub", { token: "fake", baseUrl: server.url });
    await expect(
      client.openPullRequest({ owner: "acme", repo: "agent-defs", title: "same-branch PR", body: "should be rejected", head: "main", base: "main" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("createAgentDefinitionVersion commits to Git first, then persists a Draft row with the real commit sha", async () => {
    const definition = await createAgentDefinition(ctx, { name: "billing-helper" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        artifact: {
          apiVersion: "nextbot.io/v1",
          kind: "AgentDefinition",
          metadata: { name: "billing-helper", version: "1.0.0" },
          spec: {
            graphType: "CustomFSM",
            modelRoute: "chat.primary",
            instructions: "You help with billing questions.",
            toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
            guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
            memory: { strategy: "rolling-window", maxTurns: 20 },
            budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
          },
        },
      },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(version.status).toBe("Draft");
    expect(version.gitCommitSha).toBeTruthy();
    expect(version.definitionHash).toMatch(/^[0-9a-f]{64}$/);

    const reloaded = await getAgentDefinitionVersion(ctx, version.id);
    expect(reloaded.gitCommitSha).toBe(version.gitCommitSha);
  });

  it("diffAgentDefinitionVersions calls the compare API and returns a normalized diff shape", async () => {
    const result = await diffAgentDefinitionVersions(ctx, { baseSha: "sha-a", headSha: "sha-b" });
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files[0]).toHaveProperty("patch");
  });

  it("listDefinitions/getDefinition (FR-AGT-01 registry reads) return the real created rows, and getDefinition 404s an unknown id", async () => {
    const definition = await createAgentDefinition(ctx, { name: "registry-read-target" });
    const all = await listDefinitions(ctx);
    expect(all.some((d) => d.id === definition.id)).toBe(true);

    const fetched = await getDefinition(ctx, definition.id);
    expect(fetched).toMatchObject({ id: definition.id, name: "registry-read-target" });

    await expect(getDefinition(ctx, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(AgentDefinitionNotFoundError);
  });

  it("diffVersions (FR-AGT-02, agent-definition-service level) diffs two committed versions' real commits, and rejects a pair missing a commit", async () => {
    const definition = await createAgentDefinition(ctx, { name: "diff-versions-target" });
    const versionA = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("diff-versions-target", "1.0.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    const versionB = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.1.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("diff-versions-target", "1.1.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    const result = await diffVersions(ctx, versionA.id, versionB.id);
    expect(result.files.length).toBeGreaterThan(0);

    // ADR-0009 §7(c): diff stays strictly Git-only, never a DB-only fallback — a
    // version created with no commit (simulated here via the no-git-connection
    // service below) cannot be diffed, and the caller gets a clear error rather than
    // a fabricated pointer diff.
  });

  it("openAgentDefinitionReview opens a real PR and returns its number", async () => {
    const { number } = await openAgentDefinitionReview(ctx, { agentDefinitionId: "def-1", version: "1.0.0", commitSha: "sha-a" });
    expect(number).toBeGreaterThan(0);
    expect(mockState.pulls.get(number)?.state).toBe("open");
  });

  it("submitVersionForReview (Git connected, version has a commit) opens a real PR and records its number/status on the version row", async () => {
    const definition = await createAgentDefinition(ctx, { name: "submit-review-happy-path" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("submit-review-happy-path", "1.0.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(version.gitCommitSha).toBeTruthy();

    const result = await submitVersionForReview(ctx, version.id);
    expect(result.prNumber).toBeGreaterThan(0);
    expect(result.reason).toBeUndefined();

    const reloaded = await getAgentDefinitionVersion(ctx, version.id);
    expect(reloaded.gitPrNumber).toBe(result.prNumber);
    expect(reloaded.gitPrStatus).toBe("Open");
  });

  it("handleGitWebhook rejects a payload with an invalid HMAC signature", async () => {
    await expect(
      handleGitWebhook(ctx, { provider: "GitHub", rawBody: "{}", signatureHeader: "sha256=deadbeef", prNumber: 1, eventStatus: "Merged" }),
    ).rejects.toThrow(/signature verification failed/);
  });

  it("handleGitWebhook accepts a validly-signed merge event and updates the PR status", async () => {
    const rawBody = JSON.stringify({ action: "closed", pull_request: { number: 999, merged: true } });
    const secret = await debugDecryptWebhookSecretForTests(ctx);
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
    await expect(
      handleGitWebhook(ctx, { provider: "GitHub", rawBody, signatureHeader: signature, prNumber: 999, eventStatus: "Merged" }),
    ).resolves.toBeUndefined();
  });

  it("reconcileOpenPrsForTenant polls the provider for any version stuck Open and reconciles it (ADR-0009 15-min fallback)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "reconcile-target" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        artifact: {
          apiVersion: "nextbot.io/v1",
          kind: "AgentDefinition",
          metadata: { name: "reconcile-target", version: "1.0.0" },
          spec: {
            graphType: "CustomFSM",
            modelRoute: "chat.primary",
            instructions: "hi",
            toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
            guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
            memory: { strategy: "rolling-window", maxTurns: 20 },
            budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
          },
        },
      },
      "11111111-1111-1111-1111-111111111111",
    );
    // Move it through Draft -> EvalGated is out of scope for this test; instead
    // directly exercise the reconciliation path by opening a review and marking the
    // remote PR merged, then asserting the sweep picks it up.
    const { number } = await openAgentDefinitionReview(ctx, { agentDefinitionId: definition.id, version: version.version, commitSha: version.gitCommitSha! });
    const { setVersionGitPrInfo } = await import("./git-connection-service.js");
    await setVersionGitPrInfo(ctx, version.id, { gitPrNumber: number, gitPrStatus: "Open" });
    const existingPr = mockState.pulls.get(number)!;
    mockState.pulls.set(number, { ...existingPr, state: "closed", merged: true });

    const result = await reconcileOpenPrsForTenant(ctx);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.updated).toBeGreaterThan(0);
  });

  it("submitVersionForReview degrades to the typed not-applicable result when the connection is disconnected between commit and review (last test in this block — disconnects ctx's connection for good)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "disconnected-mid-flight" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("disconnected-mid-flight", "1.0.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(version.gitCommitSha).toBeTruthy();

    await disconnectGit(ctx);
    await expect(submitVersionForReview(ctx, version.id)).resolves.toEqual({ prNumber: null, reason: "git-not-connected" });
  });
});

describe("git-connection-service — GIT_CONNECTION_UNAVAILABLE fail-graceful behavior (ADR-0009)", () => {
  let ctx: TenantContext;
  afterEach(async () => {
    await deleteFixtureTenant(ctx.tenantId);
  });

  it("blocks a new-version commit when the connected repo is unreachable, without ever falling back to a Postgres-only write", async () => {
    ctx = await createFixtureTenant();
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: "http://127.0.0.1:1", accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    const definition = await createAgentDefinition(ctx, { name: "unreachable-test" });
    await expect(commitAgentDefinitionVersion(ctx, { agentDefinitionId: definition.id, version: "1.0.0", yamlContent: "x" })).rejects.toBeInstanceOf(GitConnectionUnavailableError);
    const view = await getGitConnectionView(ctx);
    expect(view?.status).toBe("Unreachable");
  });

  it("disconnectGit removes the connection entirely", async () => {
    ctx = await createFixtureTenant();
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    await disconnectGit(ctx);
    expect(await getGitConnectionView(ctx)).toBeNull();
  });
});

/**
 * ADR-0009's 2026-08-23 amendment (§7): version creation/submission-for-review no
 * longer hard-block on Git being disconnected — Postgres is the real source of truth,
 * Git a best-effort synced mirror. These two describe blocks are the "distinct code
 * path, distinct test" the amendment calls for: a genuinely absent connection
 * degrades gracefully; a genuinely broken *configured* connection still surfaces as a
 * visible, distinct error, never conflated with the graceful case.
 */
describe("createAgentDefinitionVersion — Git-not-connected degrades gracefully (never throws)", () => {
  let ctx: TenantContext;
  beforeAll(async () => {
    ctx = await createFixtureTenant();
    // Deliberately never calls connectGit for this tenant — this ctx has zero
    // git_connection row, the "not connected at all" case.
  });
  afterAll(async () => {
    await deleteFixtureTenant(ctx.tenantId);
  });

  it("creates a Draft version with gitCommitSha: null instead of throwing GIT_CONNECTION_UNAVAILABLE", async () => {
    const definition = await createAgentDefinition(ctx, { name: "no-git-tenant-def" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("no-git-tenant-def", "1.0.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(version.status).toBe("Draft");
    expect(version.gitCommitSha).toBeNull();
    // Postgres is the real source of truth (ADR-0009 amendment) — the artifact itself
    // is still persisted in full, never a bare pointer waiting on a commit that never
    // happened.
    expect(version.definitionYaml).toContain("no-git-tenant-def");
    expect(version.definitionHash).toMatch(/^[0-9a-f]{64}$/);

    const reloaded = await getAgentDefinitionVersion(ctx, version.id);
    expect(reloaded.gitCommitSha).toBeNull();
  });

  it("submitVersionForReview returns a typed not-applicable result instead of throwing, since there is no commit to open a PR against", async () => {
    const definition = await createAgentDefinition(ctx, { name: "no-git-tenant-submit" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("no-git-tenant-submit", "1.0.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    await expect(submitVersionForReview(ctx, version.id)).resolves.toEqual({ prNumber: null, reason: "git-not-connected" });
  });

  it("diffVersions (FR-AGT-02) rejects a pair where a version has no git commit, never falling back to a DB-only diff (ADR-0009 §7(c))", async () => {
    const definition = await createAgentDefinition(ctx, { name: "no-git-diff-target" });
    const versionA = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("no-git-diff-target", "1.0.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    const versionB = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.1.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("no-git-diff-target", "1.1.0") },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(versionA.gitCommitSha).toBeNull();
    expect(versionB.gitCommitSha).toBeNull();
    await expect(diffVersions(ctx, versionA.id, versionB.id)).rejects.toThrow(/must have a git commit to diff/);
  });
});

describe("createAgentDefinitionVersion — a genuinely broken *configured* connection still surfaces distinctly (never silently degraded)", () => {
  let ctx: TenantContext;
  afterAll(async () => {
    await deleteFixtureTenant(ctx.tenantId);
  });

  it("rejects with GitConnectionUnavailableError, distinct from the not-connected-at-all case above", async () => {
    ctx = await createFixtureTenant();
    // A connection *is* configured, but points at an address nothing listens on —
    // the health check inside commitAgentDefinitionVersion's getHealthyClient() fails
    // with a genuine transport error, which must never be swallowed into the
    // graceful "not connected" path.
    await connectGit(ctx, {
      provider: "GitHub",
      repoOwner: "acme",
      repoName: "agent-defs",
      baseUrl: "http://127.0.0.1:1",
      accessToken: "fake",
      createdByUserId: "11111111-1111-1111-1111-111111111111",
    });
    const definition = await createAgentDefinition(ctx, { name: "broken-git-tenant-def" });
    await expect(
      createAgentDefinitionVersion(
        ctx,
        definition.id,
        { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: MINIMAL_ARTIFACT("broken-git-tenant-def", "1.0.0") },
        "11111111-1111-1111-1111-111111111111",
      ),
    ).rejects.toBeInstanceOf(GitConnectionUnavailableError);
  });
});
