import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, generateId, type TenantContext } from "@nextbot/db";

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — real Postgres
 * integration test for the agent-presence admin API surface, same convention as
 * `escalations/escalations-admin.int.test.ts` (real RBAC guard, only the
 * session/auth seam mocked).
 */
vi.mock("server-only", () => ({}));

let ctx: TenantContext;
let userId: string;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId, roleIds: [] }
        : { permissions: { escalations: level }, tenantId: ctx.tenantId, userId, roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

async function setUp() {
  ctx = await createFixtureTenant();
  userId = await withTenant(ctx, async (db) => {
    const [row] = await db
      .insert(schema.appUser)
      .values({ id: generateId(), tenantId: ctx.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName: "Sam", status: "Active" })
      .returning({ id: schema.appUser.id });
    return row!.id;
  });
}

describe("agent-presence admin API (Phase 13, BL-45)", () => {
  it("GET /agent-presence/me 403s without escalations=Read, 200s with it and auto-provisions Offline/3/0", async () => {
    await setUp();
    await mockSessionAs("None");
    const { GET: getForbidden } = await import("./me/route.js");
    expect((await getForbidden()).status).toBe(403);

    vi.resetModules();
    await mockSessionAs("Read");
    const { GET } = await import("./me/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; maxConcurrent: number; currentLoad: number };
    expect(body.state).toBe("Offline");
    expect(body.maxConcurrent).toBe(3);
    expect(body.currentLoad).toBe(0);
  });

  it("PATCH /agent-presence/me 403s without escalations=Write", async () => {
    await setUp();
    await mockSessionAs("None");
    const { PATCH } = await import("./me/route.js");
    const res = await PATCH(
      new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ state: "Available" }), headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /agent-presence/me sets the caller's own state, ignoring any client-supplied userId/maxConcurrent", async () => {
    await setUp();
    await mockSessionAs("Write");
    const { PATCH } = await import("./me/route.js");
    const res = await PATCH(
      new NextRequest("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ state: "Available", userId: "someone-else", maxConcurrent: 999 }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; maxConcurrent: number; userId: string };
    expect(body.state).toBe("Available");
    expect(body.maxConcurrent).toBe(3); // untouched by the extraneous field in the body
    expect(body.userId).toBe(userId); // always the acting session's own user, never client-supplied
  });

  it("PATCH /agent-presence/me 422s an invalid state", async () => {
    await setUp();
    await mockSessionAs("Write");
    const { PATCH } = await import("./me/route.js");
    const res = await PATCH(
      new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ state: "NotAState" }), headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(422);
  });

  it("PATCH /agent-presence/{userId} 403s without escalations=Write, 422s an invalid body", async () => {
    await setUp();
    await mockSessionAs("None");
    const { PATCH: forbidden } = await import("./[userId]/route.js");
    const forbiddenRes = await forbidden(
      new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ maxConcurrent: 5 }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ userId }) },
    );
    expect(forbiddenRes.status).toBe(403);

    vi.resetModules();
    await mockSessionAs("Write");
    const { PATCH } = await import("./[userId]/route.js");
    const invalidRes = await PATCH(
      new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ maxConcurrent: -1 }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ userId }) },
    );
    expect(invalidRes.status).toBe(422);
  });

  it("PATCH /agent-presence/{userId} sets another agent's max_concurrent; 404s a cross-tenant id", async () => {
    await setUp();
    await mockSessionAs("Write");
    const { PATCH } = await import("./[userId]/route.js");

    const res = await PATCH(
      new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ maxConcurrent: 5 }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ userId }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).maxConcurrent).toBe(5);

    const otherTenant = await createFixtureTenant();
    try {
      const crossTenantUserId = await withTenant(otherTenant, async (db) => {
        const [row] = await db
          .insert(schema.appUser)
          .values({ id: generateId(), tenantId: otherTenant.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName: "Other", status: "Active" })
          .returning({ id: schema.appUser.id });
        return row!.id;
      });
      const crossTenantRes = await PATCH(
        new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ maxConcurrent: 5 }), headers: { "content-type": "application/json" } }),
        { params: Promise.resolve({ userId: crossTenantUserId }) },
      );
      expect(crossTenantRes.status).toBe(404);
    } finally {
      await deleteFixtureTenant(otherTenant.tenantId);
    }
  });

  it("GET /agent-presence 403s without escalations=Read", async () => {
    await setUp();
    await mockSessionAs("None");
    const { GET } = await import("./route.js");
    expect((await GET()).status).toBe(403);
  });

  it("GET /agent-presence lists every agent's presence for the tenant", async () => {
    await setUp();
    await mockSessionAs("Read");
    const { GET: meGet } = await import("./me/route.js");
    await meGet(); // auto-provisions the caller's own row

    const { GET } = await import("./route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<{ userId: string }> };
    expect(body.agents.some((a) => a.userId === userId)).toBe(true);
  });
});
