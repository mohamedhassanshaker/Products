import { describe, expect, it, vi, beforeEach } from "vitest";

const findRoleByName = vi.fn();
const insertRole = vi.fn();

vi.mock("../infrastructure/role-repository.js", () => ({
  findRoleByName: (...a: unknown[]) => findRoleByName(...a),
  insertRole: (...a: unknown[]) => insertRole(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Production" as const };

describe("seedSystemRoles (idempotency)", () => {
  beforeEach(() => {
    findRoleByName.mockReset();
    insertRole.mockReset();
  });

  it("inserts all six roles when none exist yet", async () => {
    findRoleByName.mockResolvedValue(null);
    insertRole.mockImplementation(async (_ctx, input: { name: string }) => `id-${input.name}`);
    const { seedSystemRoles } = await import("./seed-system-roles.js");
    const ids = await seedSystemRoles(ctx);
    expect(ids).toHaveLength(6);
    expect(insertRole).toHaveBeenCalledTimes(6);
  });

  it("re-running for a tenant that already has some roles is a no-op for those roles (idempotent)", async () => {
    findRoleByName.mockImplementation(async (_ctx, name: string) => (name === "Tenant Admin" ? { id: "existing-admin" } : null));
    insertRole.mockImplementation(async (_ctx, input: { name: string }) => `id-${input.name}`);
    const { seedSystemRoles } = await import("./seed-system-roles.js");
    const ids = await seedSystemRoles(ctx);
    expect(ids).toHaveLength(6);
    expect(ids[0]).toBe("existing-admin");
    expect(insertRole).toHaveBeenCalledTimes(5);
  });
});
