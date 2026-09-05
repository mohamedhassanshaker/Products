import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, type TenantContext } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { seedSystemRoles } from "@nextbot/iam";

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
        : { permissions: { users_roles: level }, tenantId: ctx.tenantId, userId: ACTOR_USER_ID, roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

async function auditRows() {
  return withTenant(ctx, (db) => db.select().from(schema.auditLogEntry).where(eq(schema.auditLogEntry.tenantId, ctx.tenantId)));
}

/** A full (every module explicitly set) permission matrix — `PermissionMatrixSchema`
 * is a `Type.Record` over the fixed `RbacModule` union, so every key is required;
 * an empty/partial object 422s at the schema layer before ever reaching the
 * SystemRoleImmutableError/RoleNotFoundInTenantError checks this test exercises. */
function fullMatrix(overrides: Record<string, string> = {}): Record<string, string> {
  const matrix: Record<string, string> = {};
  for (const m of [
    "channels", "connectors", "tool_permissions", "agent_tool_config", "approval_queue", "escalations",
    "conversations", "reporting", "a2a_config", "agent_platform", "designer", "security_settings",
    "audit_log", "users_roles", "developer_portal", "knowledge", "knowledge_config",
  ]) {
    matrix[m] = "None";
  }
  return { ...matrix, ...overrides };
}

/**
 * Completes the "Users & Roles" screen's real gap (dispatch brief): user creation,
 * role CRUD, and role reassignment via the actual `apps/web` HTTP routes, against a
 * real (test) Postgres — not just the mocked-repository unit tests. Also proves
 * QA Final Review B4's audit-attribution requirement for every new mutating action
 * this dispatch adds.
 */
describe("Users & Roles admin API (real Postgres)", () => {
  it("POST /roles creates a custom role and records a Success audit entry attributed to the real admin", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST: createRole } = await import("../roles/route.js");

    const res = await createRole(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Approval Manager", permissionMatrix: fullMatrix({ approval_queue: "Write" }), mfaRequired: true }),
      }),
    );
    expect(res.status).toBe(201);
    const { roleId } = await res.json();

    const entries = await auditRows();
    const entry = entries.find((r) => r.actionType === "role.create");
    expect(entry?.actorId).toBe(ACTOR_USER_ID);
    expect(entry?.targetId).toBe(roleId);
    expect(entry?.outcome).toBe("Success");
  });

  it("PUT /roles/{id} rejects editing a system role with 409 and never mutates it", async () => {
    ctx = await createFixtureTenant();
    const [systemRoleId] = await seedSystemRoles(ctx);
    await mockSessionAs("Write");
    const { PUT: updateRole } = await import("../roles/[id]/route.js");

    const res = await updateRole(
      new NextRequest("http://localhost", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hacked Name", permissionMatrix: fullMatrix() }),
      }),
      { params: Promise.resolve({ id: systemRoleId! }) },
    );
    expect(res.status).toBe(409);

    const rows = await withTenant(ctx, (db) => db.select().from(schema.role).where(eq(schema.role.id, systemRoleId!)));
    expect(rows[0]?.name).toBe("Tenant Admin"); // unchanged
  });

  it("POST /users creates a user with an initial role assignment and audits it, then GET /users lists it with roles attached", async () => {
    ctx = await createFixtureTenant();
    const [tenantAdminRoleId] = await seedSystemRoles(ctx);
    await mockSessionAs("Write");
    const { POST: createUser, GET: listUsers } = await import("./route.js");

    const createRes = await createUser(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "invited@example.com",
          password: "supersecret1",
          displayName: "Invited Person",
          roleIds: [tenantAdminRoleId],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const { userId } = await createRes.json();

    const entries = await auditRows();
    const entry = entries.find((r) => r.actionType === "user.create");
    expect(entry?.actorId).toBe(ACTOR_USER_ID);
    expect(entry?.targetId).toBe(userId);

    const listRes = await listUsers();
    const { users } = await listRes.json();
    const found = users.find((u: { id: string }) => u.id === userId);
    expect(found?.email).toBe("invited@example.com");
    expect(found?.roles).toEqual([{ id: tenantAdminRoleId, name: "Tenant Admin" }]);
  });

  it("POST /users rejects a roleId that doesn't belong to this tenant with 422", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST: createUser } = await import("./route.js");

    const res = await createUser(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ghost-role@example.com",
          password: "supersecret1",
          displayName: "Ghost Role",
          roleIds: ["00000000-0000-7000-8000-000000000099"],
        }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("GET/POST /users return 401 with no session at all", async () => {
    ctx = await createFixtureTenant();
    vi.doMock("@/src/lib/session", () => ({ getSession: async () => null, getSessionTenantContext: async () => ctx }));
    const { GET: listUsers, POST: createUser } = await import("./route.js");
    expect((await listUsers()).status).toBe(401);
    expect(
      (
        await createUser(
          new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
        )
      ).status,
    ).toBe(401);
  });

  it("PUT /users/{id}/roles reassigns roles and audits the change", async () => {
    ctx = await createFixtureTenant();
    const [tenantAdminRoleId, , , , , readOnlyRoleId] = await seedSystemRoles(ctx);
    await mockSessionAs("Write");
    const { POST: createUser } = await import("./route.js");
    const { PUT: updateRoles } = await import("./[id]/roles/route.js");

    const createRes = await createUser(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "reassign@example.com",
          password: "supersecret1",
          displayName: "Reassign Me",
          roleIds: [tenantAdminRoleId],
        }),
      }),
    );
    const { userId } = await createRes.json();

    const res = await updateRoles(
      new NextRequest("http://localhost", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleIds: [readOnlyRoleId] }),
      }),
      { params: Promise.resolve({ id: userId }) },
    );
    expect(res.status).toBe(200);

    const entries = await auditRows();
    const entry = entries.find((r) => r.actionType === "user.roles_update");
    expect(entry?.actorId).toBe(ACTOR_USER_ID);
    expect(entry?.targetId).toBe(userId);
  });
});
