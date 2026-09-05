import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { issueSandboxPreviewToken } from "@nextbot/iam";
import { handleCreateDefinition, handleCreateVersion, handleGetVersion } from "@nextbot/agent-platform";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { POST as createSession } from "./sessions/route.js";
import { POST as sendMessage } from "./messages/route.js";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "sandbox-gate-e2e", version: "1.0.0" },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions: "You are a helpful support agent.",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
};

/**
 * Phase 7 (client-feedback-batch item 6) — the specific, real-infrastructure proof
 * this dispatch's own verification section calls for: the `Approved -> Production`
 * sandbox-test gate cannot be gamed by merely opening the Sandbox tab's chat
 * preview (session creation) — it requires an actual, completed conversation turn.
 * Every step below goes through the real HTTP routes (`apps/gateway`'s
 * `POST /widget/sessions` and `POST /widget/messages`), the real turn pipeline
 * (`@nextbot/orchestration`'s `runTurnPipeline`, via `apps/gateway`'s real
 * `turn-pipeline-adapter.ts` composition-root wiring — the same wiring a genuine
 * browser-driven sandbox preview goes through), and a real Postgres-backed
 * `agent_definition_version` row — not a direct call to `recordSandboxTest` (that
 * function itself is already proven in isolation by
 * `promote-version-service.int.test.ts`).
 */
describe("sandbox-preview session -> real completed turn -> recordSandboxTest (Phase 7, client-feedback-batch item 6)", () => {
  let aiServer: MockOpenAiServerHandle;

  beforeAll(async () => {
    aiServer = await startMockOpenAiCompatibleServer({
      onChatCompletion: () => ({ content: JSON.stringify({ action: "reply", replyText: "Sure, happy to help!", confidence: 0.95 }) }),
    });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = aiServer.url;
    process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
    process.env.AI_MODEL_REASONING_PLANNER = "test-model";
    process.env.AI_API_KEY = "test-key";
  });
  afterAll(async () => {
    await aiServer.close();
  });

  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });
  beforeEach(() => {
    process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
    process.env.NEXTBOT_SESSION_SECRET = "a-sufficiently-long-test-session-secret-1234";
  });

  function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  }

  async function setUp() {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Sandbox Test Gate E2E Widget", environment: "Production" });
    const resolved = await resolveTenantById(tenant.tenantId);
    const definition = await handleCreateDefinition(tenant, { name: "sandbox-gate-e2e" });
    const version = await handleCreateVersion(tenant, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    return { tenant, channel, tenantSlug: resolved!.slug, version };
  }

  async function readLastSandboxTestAt(tenant: TenantContext, versionId: string): Promise<Date | null> {
    const view = await handleGetVersion(tenant, versionId, "11111111-1111-1111-1111-111111111111");
    return (view as { lastSandboxTestAt: Date | null }).lastSandboxTestAt;
  }

  it("does NOT record a sandbox test merely from opening the preview (creating a session) — only a real completed turn does", async () => {
    const { tenant, channel, tenantSlug, version } = await setUp();
    expect(await readLastSandboxTestAt(tenant, version.id)).toBeNull();

    const token = await issueSandboxPreviewToken(tenant.tenantId, "admin-user-1", version.id);
    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: version.id,
        previewToken: token,
      }),
    );
    expect(sessionRes.status).toBe(201);

    // Adversarial check per this phase's own verification requirement: the session
    // (and, in a real browser, the iframe/chat panel) exists now — but no message
    // was ever sent, so no turn ever ran, so the gate must still be unsatisfied.
    expect(await readLastSandboxTestAt(tenant, version.id)).toBeNull();
  });

  it("records a real sandbox test once a real message is sent and a real completed turn comes back", async () => {
    const { tenant, channel, tenantSlug, version } = await setUp();
    const token = await issueSandboxPreviewToken(tenant.tenantId, "admin-user-1", version.id);
    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: version.id,
        previewToken: token,
      }),
    );
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as { sessionToken: string; conversationId: string };
    expect(await readLastSandboxTestAt(tenant, version.id)).toBeNull();

    // A real customer-shaped message, through the real HTTP route, answered by a
    // real (mocked-HTTP, not mocked-at-the-code-layer) model backend.
    const messageRes = await sendMessage(
      jsonRequest(
        "http://localhost/api/v1/widget/messages",
        { clientMessageId: "sandbox-gate-1", contentType: "Text", payload: { contentType: "Text", text: "Can you help me with my order?" } },
        { authorization: `Bearer ${session.sessionToken}`, "idempotency-key": "sandbox-gate-1" },
      ),
    );
    expect(messageRes.status).toBe(202);
    const result = (await messageRes.json()) as { runId: string | null };
    expect(result.runId).not.toBeNull();

    const lastSandboxTestAt = await readLastSandboxTestAt(tenant, version.id);
    expect(lastSandboxTestAt).not.toBeNull();
    expect(lastSandboxTestAt!.getTime()).not.toBeNaN();
  });

  it("never records a sandbox test against an ordinary (non-preview) widget conversation", async () => {
    const { tenant, channel, tenantSlug, version } = await setUp();
    const ordinarySessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug, channelPublicKey: channel.publicKey }),
    );
    expect(ordinarySessionRes.status).toBe(201);
    const ordinarySession = (await ordinarySessionRes.json()) as { sessionToken: string };

    await sendMessage(
      jsonRequest(
        "http://localhost/api/v1/widget/messages",
        { clientMessageId: "ordinary-1", contentType: "Text", payload: { contentType: "Text", text: "hello" } },
        { authorization: `Bearer ${ordinarySession.sessionToken}`, "idempotency-key": "ordinary-1" },
      ),
    );

    // This version was never the sandbox-preview target for that conversation, so
    // its own `lastSandboxTestAt` must stay untouched by ordinary traffic.
    expect(await readLastSandboxTestAt(tenant, version.id)).toBeNull();
  });
});
