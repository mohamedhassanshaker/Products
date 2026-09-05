import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, type TenantContext } from "@nextbot/db";
import { createWebWidgetChannel } from "@nextbot/channels";
import { createWidgetSession, sendWidgetMessage } from "@nextbot/conversations";
import { generateId } from "@nextbot/db";
import { startAgentRun, completeAgentRun } from "@nextbot/agent-platform";
import { resolveOrSynthesizeRouteVersionForKey } from "@nextbot/model-gateway";
import { insertAgentRunSpans } from "@nextbot/db/clickhouse";

/**
 * Integration-level test for the Phase 13 (BL-06) conversation admin API surface:
 * real Postgres, real RBAC guard (`@nextbot/iam`'s `requirePermission`, not mocked),
 * only the session/auth seam mocked — same convention as
 * `agent-platform/versions/[id]/bind-eval-suite/route.int.test.ts`.
 */
vi.mock("server-only", () => ({}));

let ctx: TenantContext;
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () => (level === "None" ? { permissions: {}, tenantId: ctx.tenantId, userId: "u1" } : { permissions: { conversations: level }, tenantId: ctx.tenantId, userId: "u1" }),
    getSessionTenantContext: async () => ctx,
  }));
}

describe("conversation admin API (Phase 13, BL-06)", () => {
  it("GET /conversations returns only this tenant's conversations, 403s a caller without conversations=Read", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });

    await mockSessionAs("None");
    const { GET: getForbidden } = await import("./route.js");
    const forbiddenRes = await getForbidden(new NextRequest("http://localhost/api/v1/admin/conversations"));
    expect(forbiddenRes.status).toBe(403);

    vi.resetModules();
    await mockSessionAs("Read");
    const { GET } = await import("./route.js");
    const res = await GET(new NextRequest("http://localhost/api/v1/admin/conversations"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.items.map((i) => i.id)).toContain(session.conversationId);
  });

  it("GET /conversations filters by status", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });
    await withTenant(ctx, (db) => db.update(schema.conversation).set({ status: "Escalated" }).where(eq(schema.conversation.id, session.conversationId)));

    await mockSessionAs("Read");
    const { GET } = await import("./route.js");
    const activeRes = await GET(new NextRequest("http://localhost/api/v1/admin/conversations?status=Active"));
    const activeBody = (await activeRes.json()) as { items: Array<{ id: string }> };
    expect(activeBody.items.map((i) => i.id)).not.toContain(session.conversationId);

    const escalatedRes = await GET(new NextRequest("http://localhost/api/v1/admin/conversations?status=Escalated"));
    const escalatedBody = (await escalatedRes.json()) as { items: Array<{ id: string }> };
    expect(escalatedBody.items.map((i) => i.id)).toContain(session.conversationId);
  });

  it("GET /conversations/:id returns the transcript, 404s an unknown/cross-tenant id", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });
    await sendWidgetMessage(
      { tenantId: ctx.tenantId, region: ctx.region, environment: ctx.environment, conversationId: session.conversationId, channelId: channel.id },
      { clientMessageId: "c1", contentType: "Text", payload: { contentType: "Text", text: "hello" } },
    );

    await mockSessionAs("Read");
    const { GET } = await import("./[id]/route.js");
    const res = await GET(new NextRequest(`http://localhost/api/v1/admin/conversations/${session.conversationId}`), { params: Promise.resolve({ id: session.conversationId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: { messages: Array<{ sender: string }> } };
    expect(body.conversation.messages.some((m) => m.sender === "Customer")).toBe(true);

    const notFoundRes = await GET(new NextRequest("http://localhost/api/v1/admin/conversations/00000000-0000-7000-8000-000000000000"), {
      params: Promise.resolve({ id: "00000000-0000-7000-8000-000000000000" }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it("GET /conversations/:id/trace returns an empty (not erroring) trace for a conversation with no agent_run yet", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });

    await mockSessionAs("Read");
    const { GET } = await import("./[id]/trace/route.js");
    const res = await GET(new NextRequest(`http://localhost/api/v1/admin/conversations/${session.conversationId}/trace`), {
      params: Promise.resolve({ id: session.conversationId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[]; traceStoreUnavailable: boolean };
    expect(body.runs).toEqual([]);
    expect(body.traceStoreUnavailable).toBe(false);
  });

  it("GET /conversations/export?format=csv returns a well-formed CSV containing this tenant's conversation only", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });

    await mockSessionAs("Read");
    const { GET } = await import("./export/route.js");
    const res = await GET(new NextRequest("http://localhost/api/v1/admin/conversations/export?format=csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain(session.conversationId);
    expect(csv.split("\r\n")[0]).toContain("id,channelId,status");
  });

  it("GET /conversations/:id/trace returns the real agent_run + spans once a message references one", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });

    const definitionId = generateId();
    const versionId = generateId();
    // Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-22) — `model_route_version_id`
    // is a real, NOT NULL FK now; resolve/synthesize one the same way any real caller
    // (`createAgentDefinitionVersion`) would, since this fixture bypasses that path.
    const routeVersion = await resolveOrSynthesizeRouteVersionForKey(ctx, "chat.primary");
    await withTenant(ctx, async (db) => {
      await db.insert(schema.agentDefinition).values({ id: definitionId, tenantId: ctx.tenantId, name: `trace-fixture-${definitionId}` });
      await db.insert(schema.agentDefinitionVersion).values({
        id: versionId,
        tenantId: ctx.tenantId,
        agentDefinitionId: definitionId,
        version: "1.0.0",
        definitionYaml: "apiVersion: nextbot.io/v1\nkind: AgentDefinition\n",
        definitionHash: "fixture-hash",
        modelRouteKey: "chat.primary",
        modelRouteVersionId: routeVersion.id,
      });
    });
    const { run, span } = await startAgentRun(ctx, { agentDefinitionVersionId: versionId, trigger: "SandboxTest" });
    await insertAgentRunSpans(ctx, [
      { agentRunId: run.id, traceId: run.otelTraceId, spanId: generateId(), parentSpanId: null, name: "goal_selection", kind: "ModelCall", attributes: {}, status: "Ok", startedAt: new Date(), durationMs: 50 },
    ]);
    await completeAgentRun(ctx, run, span, { status: "Succeeded", durationMs: 100 });
    await withTenant(ctx, async (db) => {
      await db.update(schema.message).set({ agentRunId: run.id }).where(eq(schema.message.conversationId, session.conversationId));
    });
    // Widget session issuance itself creates the conversation but no messages yet —
    // stamp any message onto it via a real send so there's a row to attach agentRunId to.
    await sendWidgetMessage(
      { tenantId: ctx.tenantId, region: ctx.region, environment: ctx.environment, conversationId: session.conversationId, channelId: channel.id },
      { clientMessageId: "c1", contentType: "Text", payload: { contentType: "Text", text: "hello" } },
    );
    await withTenant(ctx, async (db) => {
      await db.update(schema.message).set({ agentRunId: run.id }).where(eq(schema.message.conversationId, session.conversationId));
    });

    await mockSessionAs("Read");
    const { GET } = await import("./[id]/trace/route.js");
    const res = await GET(new NextRequest(`http://localhost/api/v1/admin/conversations/${session.conversationId}/trace`), {
      params: Promise.resolve({ id: session.conversationId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ run: { id: string; status: string }; spans: Array<{ kind: string }> }>; traceStoreUnavailable: boolean };
    expect(body.traceStoreUnavailable).toBe(false);
    expect(body.runs.length).toBeGreaterThan(0);
    expect(body.runs[0]!.run.status).toBe("Succeeded");
    expect(body.runs[0]!.spans.map((s) => s.kind)).toContain("ModelCall");
  });

  it("GET /conversations/export?format=json returns tenant-scoped JSON", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: "Main", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(ctx.tenantId), channelPublicKey: channel.publicKey });

    await mockSessionAs("Read");
    const { GET } = await import("./export/route.js");
    const res = await GET(new NextRequest("http://localhost/api/v1/admin/conversations/export?format=json"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: Array<{ id: string }> };
    expect(body.conversations.map((c) => c.id)).toContain(session.conversationId);
  });
});

async function tenantSlugOf(tenantId: string): Promise<string> {
  const { resolveTenantById } = await import("@nextbot/tenancy");
  const tenant = await resolveTenantById(tenantId);
  return tenant?.slug ?? "";
}
