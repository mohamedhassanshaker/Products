import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantPlanTier } from "@nextbot/tenancy";
import { ScimAuthenticationFailedError, ScimConflictError, ScimUserNotFoundError } from "@nextbot/contracts";
import { seedSystemRoles } from "./seed-system-roles.js";
import { createScimUser, deleteScimUser, getScimUser, listScimUsers, replaceScimUser, setScimUserActive } from "./scim-users.js";
import { hasActiveScimToken, revokeScimToken, rotateScimToken, verifyScimBearerToken } from "./scim-token.js";
import { isSessionActive } from "../infrastructure/session-repository.js";
import { insertAuthSession } from "../infrastructure/session-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function makeEnterpriseTenant() {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  await updateTenantPlanTier(ctx.tenantId, "Enterprise");
  const roleIds = await seedSystemRoles(ctx);
  return { ctx, roleId: roleIds[0]! };
}

describe("SCIM Users resource (Phase 4, BL-36, FR-SEC-10) — real Postgres", () => {
  it("creates a user via SCIM landing in exactly the right tenant, with role assignment", async () => {
    const { ctx, roleId } = await makeEnterpriseTenant();
    const user = await createScimUser(ctx, { userName: "scim1@example.com", displayName: "SCIM User", roleIds: [roleId] });
    expect(user.userName).toBe("scim1@example.com");
    expect(user.active).toBe(true);
    expect(user.roleIds).toEqual([roleId]);

    const fetched = await getScimUser(ctx, user.id);
    expect(fetched.id).toBe(user.id);
  });

  it("rejects a duplicate userName within the same tenant", async () => {
    const { ctx, roleId } = await makeEnterpriseTenant();
    await createScimUser(ctx, { userName: "dup@example.com", displayName: "A", roleIds: [roleId] });
    await expect(createScimUser(ctx, { userName: "dup@example.com", displayName: "B", roleIds: [roleId] })).rejects.toThrow(ScimConflictError);
  });

  it("SECURITY-CRITICAL: a user SCIM-provisioned in tenant A is completely invisible from tenant B's context — no cross-tenant leakage", async () => {
    const { ctx: ctxA, roleId: roleIdA } = await makeEnterpriseTenant();
    const { ctx: ctxB } = await makeEnterpriseTenant();

    const userA = await createScimUser(ctxA, { userName: "isolated@example.com", displayName: "Isolated", roleIds: [roleIdA] });

    // Tenant B's own listing never contains tenant A's user.
    const listB = await listScimUsers(ctxB);
    expect(listB.find((u) => u.id === userA.id)).toBeUndefined();
    expect(listB.find((u) => u.userName === "isolated@example.com")).toBeUndefined();

    // A direct id-based GET under tenant B's context does not resolve tenant A's user.
    await expect(getScimUser(ctxB, userA.id)).rejects.toThrow(ScimUserNotFoundError);

    // Tenant A can still see its own user.
    const fetchedA = await getScimUser(ctxA, userA.id);
    expect(fetchedA.id).toBe(userA.id);
  });

  it("PATCH active:false deactivates (never hard-deletes) and revokes every active session", async () => {
    const { ctx, roleId } = await makeEnterpriseTenant();
    const user = await createScimUser(ctx, { userName: "deprovision@example.com", displayName: "D", roleIds: [roleId] });
    const sid = await insertAuthSession(ctx, { userId: user.id });
    await expect(isSessionActive(ctx, sid)).resolves.toBe(true);

    const deactivated = await setScimUserActive(ctx, user.id, false);
    expect(deactivated.active).toBe(false);
    await expect(isSessionActive(ctx, sid)).resolves.toBe(false);

    // The row still exists (never physically deleted) — a subsequent GET still resolves it.
    const stillThere = await getScimUser(ctx, user.id);
    expect(stillThere.id).toBe(user.id);
  });

  it("DELETE deactivates rather than physically removing the row", async () => {
    const { ctx, roleId } = await makeEnterpriseTenant();
    const user = await createScimUser(ctx, { userName: "delete-me@example.com", displayName: "D", roleIds: [roleId] });
    await deleteScimUser(ctx, user.id);
    const stillThere = await getScimUser(ctx, user.id);
    expect(stillThere.active).toBe(false);
  });

  it("PUT replaces role assignment set (not incremental)", async () => {
    const { ctx, roleId } = await makeEnterpriseTenant();
    const user = await createScimUser(ctx, { userName: "replace@example.com", displayName: "R", roleIds: [roleId] });
    const replaced = await replaceScimUser(ctx, user.id, { displayName: "Renamed", active: true, roleIds: [] });
    expect(replaced.displayName).toBe("Renamed");
    expect(replaced.roleIds).toEqual([]);
  });
});

describe("SCIM bearer-token auth boundary (Phase 4, BL-36) — real Postgres", () => {
  it("hasActiveScimToken reflects false before rotation, true after, false again after revoke", async () => {
    const { ctx } = await makeEnterpriseTenant();
    await expect(hasActiveScimToken(ctx)).resolves.toBe(false);
    await rotateScimToken(ctx);
    await expect(hasActiveScimToken(ctx)).resolves.toBe(true);
    await revokeScimToken(ctx);
    await expect(hasActiveScimToken(ctx)).resolves.toBe(false);
  });

  it("rejects rotating a SCIM token for a non-Enterprise tenant (NFR-17)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { SsoPlanTierNotEligibleError } = await import("@nextbot/contracts");
    await expect(rotateScimToken(ctx)).rejects.toThrow(SsoPlanTierNotEligibleError);
  });

  it("resolves the correct tenant for a real, freshly-rotated token", async () => {
    const { ctx } = await makeEnterpriseTenant();
    const token = await rotateScimToken(ctx);
    const { resolveTenantById } = await import("@nextbot/tenancy");
    const tenant = await resolveTenantById(ctx.tenantId);
    const resolvedCtx = await verifyScimBearerToken(tenant!.slug, token);
    expect(resolvedCtx.tenantId).toBe(ctx.tenantId);
  });

  it("SECURITY-CRITICAL: fails closed on a wrong/forged token against a real, valid tenant slug", async () => {
    const { ctx } = await makeEnterpriseTenant();
    await rotateScimToken(ctx);
    const { resolveTenantById } = await import("@nextbot/tenancy");
    const tenant = await resolveTenantById(ctx.tenantId);
    await expect(verifyScimBearerToken(tenant!.slug, "scim_totally-wrong-secret")).rejects.toThrow(ScimAuthenticationFailedError);
  });

  it("rejects a token presented against an unresolvable tenant slug", async () => {
    await expect(verifyScimBearerToken("no-such-tenant-slug-at-all", "scim_anything")).rejects.toThrow(ScimAuthenticationFailedError);
  });

  it("rejects a token that used to be valid but was rotated away (only one active token per tenant)", async () => {
    const { ctx } = await makeEnterpriseTenant();
    const firstToken = await rotateScimToken(ctx);
    await rotateScimToken(ctx); // rotating issues a new one and revokes the old.
    const { resolveTenantById } = await import("@nextbot/tenancy");
    const tenant = await resolveTenantById(ctx.tenantId);
    await expect(verifyScimBearerToken(tenant!.slug, firstToken)).rejects.toThrow(ScimAuthenticationFailedError);
  });

  it("cross-tenant: tenant A's SCIM token never authenticates against tenant B's slug", async () => {
    const { ctx: ctxA } = await makeEnterpriseTenant();
    const { ctx: ctxB } = await makeEnterpriseTenant();
    const tokenA = await rotateScimToken(ctxA);
    await rotateScimToken(ctxB);
    const { resolveTenantById } = await import("@nextbot/tenancy");
    const tenantB = await resolveTenantById(ctxB.tenantId);
    await expect(verifyScimBearerToken(tenantB!.slug, tokenA)).rejects.toThrow(ScimAuthenticationFailedError);
  });
});
