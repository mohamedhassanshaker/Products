import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, type TenantContext } from "@nextbot/db";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { discoverAndSyncTools, listCatalog, updateToolRules } from "@nextbot/tool-registry";
import { runTierEngine } from "@nextbot/orchestration";
import { __resetBreakerStateForTests } from "@nextbot/mcp-client";
import { eq } from "drizzle-orm";

const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return { ...actual, discoverTools: (...args: unknown[]) => discoverToolsMock(...args) };
});

const callToolMock = vi.fn();
vi.mock("@nextbot/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, callTool: (...args: unknown[]) => callToolMock(...args) };
});

vi.mock("server-only", () => ({}));

let ctx: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
  discoverToolsMock.mockReset();
  callToolMock.mockReset();
  await __resetBreakerStateForTests();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId: "00000000-0000-7000-8000-000000000001", roleIds: [] }
        : { permissions: { approval_queue: level }, tenantId: ctx.tenantId, userId: "00000000-0000-7000-8000-000000000001", roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

/** Sets up one Tier-3 tool with a real connector, and suspends one real tool call for
 * it into the Approval Queue via the real `runTierEngine` (same path the turn
 * pipeline uses) — so these tests exercise the real admin routes against a genuine
 * pending approval, not a hand-inserted row. */
async function setUpPendingTier3Approval(connectorName = "Billing") {
  ctx = await createFixtureTenant();
  discoverToolsMock.mockResolvedValue([{ name: "issue_refund", inputSchema: { type: "object" } }]);
  const connector = await createConnector(ctx, {
    name: connectorName,
    backendType: "Billing",
    transport: "StreamableHTTP",
    endpointUrl: "https://billing.example.com/mcp",
    authMethod: "None",
    environment: "Sandbox",
  });
  await withTenant(ctx, async (db) => {
    await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
  });
  await discoverAndSyncTools(ctx, connector.id);
  const [tool] = await listCatalog(ctx, { connectorId: connector.id });
  await updateToolRules(ctx, tool!.id, [
    { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
  ]);

  const channel = await createWebWidgetChannel(ctx, { name: "Billing Widget", environment: "Sandbox" });
  const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

  const outcome = await runTierEngine(
    ctx,
    tool!.id,
    {},
    { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: { amount: 250 } },
  );
  if (outcome.kind !== "SuspendedForApproval") throw new Error("expected the fixture tool call to suspend for Tier-3 approval");
  return { connector, tool: tool!, conversationId, toolCallId: outcome.toolCallId };
}

describe("approvals admin API (Phase 14/16, QA fix D1 + BE2)", () => {
  it("GET /approvals (D1): backendName/channelType are the real connector/channel, not hardcoded null", async () => {
    await setUpPendingTier3Approval("Refunds Backend");
    await mockSessionAs("Read");
    const { GET } = await import("./route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ backendName: string | null; channelType: string | null }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.backendName).toBe("Refunds Backend");
    expect(body.items[0]!.channelType).toBe("WebWidget");
  });

  it("GET /approvals 403s without approval_queue=Read", async () => {
    await setUpPendingTier3Approval();
    await mockSessionAs("None");
    const { GET } = await import("./route.js");
    expect((await GET()).status).toBe(403);
  });

  it("GET /approvals/{id} 403s without approval_queue=Read, 404s an unknown id", async () => {
    await setUpPendingTier3Approval();
    await mockSessionAs("None");
    const { GET: detail } = await import("./[id]/route.js");
    const forbidden = await detail(new NextRequest("http://localhost/api/v1/admin/approvals/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(forbidden.status).toBe(403);

    vi.resetModules();
    await mockSessionAs("Read");
    const { GET: detail2 } = await import("./[id]/route.js");
    const notFound = await detail2(new NextRequest("http://localhost/api/v1/admin/approvals/nope"), {
      params: Promise.resolve({ id: "00000000-0000-7000-8000-000000000000" }),
    });
    expect(notFound.status).toBe(404);
  });

  it("GET /approvals/{id} (D1): backendName is the real connector name", async () => {
    const { toolCallId } = await setUpPendingTier3Approval("Refunds Backend 2");
    await mockSessionAs("Read");
    const { GET: list } = await import("./route.js");
    const listRes = await list();
    const { items } = (await listRes.json()) as { items: Array<{ id: string; toolCallId: string }> };
    const approvalId = items.find((i) => i.toolCallId === toolCallId)!.id;

    vi.resetModules();
    await mockSessionAs("Read");
    const { GET: detail } = await import("./[id]/route.js");
    const detailRes = await detail(new NextRequest(`http://localhost/api/v1/admin/approvals/${approvalId}`), {
      params: Promise.resolve({ id: approvalId }),
    });
    expect(detailRes.status).toBe(200);
    expect((await detailRes.json()).backendName).toBe("Refunds Backend 2");
  });

  it("POST /approvals/{id}/decision (BE2): Approve is rejected 409 when the circuit breaker has since tripped, without executing", async () => {
    const { toolCallId } = await setUpPendingTier3Approval();
    // Trip the shared breaker for this exact (tenant, tool) — simulating consecutive
    // failures that occurred elsewhere (e.g. AI-initiated calls) while this Tier-3
    // approval sat pending.
    const { findToolCallById } = await import("@nextbot/orchestration");
    const toolCall = await findToolCallById(ctx, toolCallId);
    const { recordBreakerOutcome } = await import("@nextbot/mcp-client");
    for (let i = 0; i < 5; i++) await recordBreakerOutcome(ctx.tenantId, toolCall!.toolId, false);

    await mockSessionAs("Write");
    const { POST: decide } = await import("./[id]/decision/route.js");
    const res = await decide(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-be2-1" },
        body: JSON.stringify({ decision: "Approved" }),
      }),
      { params: Promise.resolve({ id: toolCallId }) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("TOOL_NO_LONGER_PERMITTED");
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("POST /approvals/{id}/decision (BE2): Approve is rejected 409 when an admin has since added a Deny rule, without executing", async () => {
    const { toolCallId, tool } = await setUpPendingTier3Approval();
    // Simulate an admin denying the tool after the approval was originally requested.
    await updateToolRules(ctx, tool.id, [{ scope: "Tool", toolId: tool.id, ordinal: 0, conditions: {}, effect: "Deny", enabled: true }]);

    await mockSessionAs("Write");
    const { POST: decide } = await import("./[id]/decision/route.js");
    const res = await decide(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-be2-2" },
        body: JSON.stringify({ decision: "Approved" }),
      }),
      { params: Promise.resolve({ id: toolCallId }) },
    );
    expect(res.status).toBe(409);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("POST /approvals/{id}/decision 422s a missing Idempotency-Key and an invalid body, 403s without approval_queue=Write", async () => {
    const { toolCallId } = await setUpPendingTier3Approval();

    await mockSessionAs("Write");
    const { POST: decide } = await import("./[id]/decision/route.js");
    const missingKeyRes = await decide(
      new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "Approved" }) }),
      { params: Promise.resolve({ id: toolCallId }) },
    );
    expect(missingKeyRes.status).toBe(422);

    const invalidBodyRes = await decide(
      new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "idem-x" }, body: "not json" }),
      { params: Promise.resolve({ id: toolCallId }) },
    );
    expect(invalidBodyRes.status).toBe(422);

    vi.resetModules();
    await mockSessionAs("None");
    const { POST: decideForbidden } = await import("./[id]/decision/route.js");
    const forbiddenRes = await decideForbidden(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-y" },
        body: JSON.stringify({ decision: "Approved" }),
      }),
      { params: Promise.resolve({ id: toolCallId }) },
    );
    expect(forbiddenRes.status).toBe(403);
  });

  it("POST /approvals/{id}/decision (BE2): Approve still succeeds end-to-end when nothing has changed since the request", async () => {
    const { toolCallId } = await setUpPendingTier3Approval();
    callToolMock.mockResolvedValue({ status: "refunded" });

    await mockSessionAs("Write");
    const { POST: decide } = await import("./[id]/decision/route.js");
    const res = await decide(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-be2-3" },
        body: JSON.stringify({ decision: "Approved" }),
      }),
      { params: Promise.resolve({ id: toolCallId }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("Succeeded");
    expect(callToolMock).toHaveBeenCalled();
  });

  // QA Final Review B4: a Tier-3 approve/reject decision must produce an audit
  // entry attributed to the deciding admin, not `system`.
  it("POST /approvals/{id}/decision records an audit entry attributed to the approving admin", async () => {
    const { toolCallId } = await setUpPendingTier3Approval();
    callToolMock.mockResolvedValue({ status: "refunded" });

    await mockSessionAs("Write");
    const { POST: decide } = await import("./[id]/decision/route.js");
    await decide(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-be2-audit" },
        body: JSON.stringify({ decision: "Approved" }),
      }),
      { params: Promise.resolve({ id: toolCallId }) },
    );

    const rows = await withTenant(ctx, (db) =>
      db.select().from(schema.auditLogEntry).where(eq(schema.auditLogEntry.tenantId, ctx.tenantId)),
    );
    const approvalEntry = rows.find((r) => r.actionType === "approval.approved");
    expect(approvalEntry).toBeDefined();
    expect(approvalEntry?.actorId).toBe("00000000-0000-7000-8000-000000000001");
    expect(approvalEntry?.outcome).toBe("Success");
  });
});
