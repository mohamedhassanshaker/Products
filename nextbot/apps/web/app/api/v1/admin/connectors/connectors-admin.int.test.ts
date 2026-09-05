import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, type TenantContext } from "@nextbot/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const ACTOR_USER_ID = "00000000-0000-7000-8000-000000000042";

let ctx: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId: ACTOR_USER_ID, roleIds: [] }
        : { permissions: { connectors: level }, tenantId: ctx.tenantId, userId: ACTOR_USER_ID, roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

/**
 * QA Final Review B4: connector create must produce an audit entry attributed
 * to the real acting admin, not `system` (`recordAuditEntry` was previously
 * called from exactly one place in the whole codebase — the DSR delete flow).
 */
describe("connectors admin API — audit wiring (QA Final Review B4)", () => {
  it("POST /connectors records a Success audit entry attributed to the real admin", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST: create } = await import("./route.js");

    const res = await create(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Audit Test Connector",
          backendType: "CRM",
          transport: "StreamableHTTP",
          endpointUrl: "https://crm.example.com/mcp",
          authMethod: "None",
          environment: "Sandbox",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const { connector } = await res.json();

    const rows = await withTenant(ctx, (db) =>
      db.select().from(schema.auditLogEntry).where(eq(schema.auditLogEntry.tenantId, ctx.tenantId)),
    );
    const entry = rows.find((r) => r.actionType === "connector.create");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(ACTOR_USER_ID);
    expect(entry?.targetId).toBe(connector.id);
    expect(entry?.outcome).toBe("Success");
  });

  it("POST /connectors records a Failure audit entry when the connector name is a duplicate", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST: create } = await import("./route.js");
    const payload = {
      name: "Dup Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    };
    await create(new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const secondRes = await create(
      new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(secondRes.status).toBe(409);

    const rows = await withTenant(ctx, (db) =>
      db.select().from(schema.auditLogEntry).where(eq(schema.auditLogEntry.tenantId, ctx.tenantId)),
    );
    const failureEntry = rows.find((r) => r.actionType === "connector.create" && r.outcome === "Failure");
    expect(failureEntry).toBeDefined();
    expect(failureEntry?.actorId).toBe(ACTOR_USER_ID);
  });
});
