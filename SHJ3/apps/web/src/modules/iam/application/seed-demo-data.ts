/**
 * The application-layer half of the deterministic demo-data seed (`scripts/seed-iam-demo-
 * data.ts` is the composition root and the CLI entry point).
 *
 * ## Why this is several small, single-tenant-scoped functions, not one orchestrator
 *
 * An earlier draft of this file was one function looping over every tenant and calling
 * `DemoDataSeeder`'s per-tenant methods (`seedSeededRolesAndGrants`, `ensureTeam`, ...)
 * directly. That is wrong: those methods reach `getTenantDb()`, which resolves its schema
 * from the *ambient* bound tenant (`runWithTenant`), not from a parameter — so a single
 * ambient binding cannot correctly serve calls meant for several different tenants in the
 * same loop (`prisma-user-repository.ts`'s `assertMatchesAmbientTenant` is the same
 * invariant, enforced defensively at the adapter layer, and would have caught this at
 * runtime rather than silently routing to the wrong schema).
 *
 * `runWithTenant` must not be called from a feature module (`tenant-context.ts`'s own doc
 * comment) — it is the composition root's job, exactly like `tests/isolation/setup.ts`'s
 * `runAsProvisioning` and `seed-system-skins.ts`'s own inline binding. So each function here
 * assumes its caller has *already* bound the correct context for whichever tenant (or the
 * platform-only "bootstrap" pseudo-tenant) this specific call needs, and does exactly one
 * tenant's (or the platform's) worth of work — the CLI script is what loops and re-binds
 * between tenants.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { DemoDataSeeder } from "../ports/demo-data-seeder.js";
import type { StaffUserStatus } from "../ports/user-repository.js";
import type { TeamScope } from "../ports/team-repository.js";

export interface DemoTenant {
  readonly slug: TenantSlug;
  /** The team B9 tab 2 shows for this tenant — one team per tenant in the wireframe's own sample data. */
  readonly team: { readonly name: string; readonly scope: TeamScope };
}

export interface DemoStaffUser {
  readonly email: string;
  readonly displayName: string;
  readonly status: StaffUserStatus;
  /** Which tenant's team/role this user is seeded into — also their `homeTenant`. */
  readonly tenant: TenantSlug;
  /** The persisted `Role.key` (`domain/permissions.ts`'s `ROLE_KEYS`) to assign in `tenant`. */
  readonly roleKey: string;
}

/** Platform-scoped, tenant-agnostic — `platform.Permissions` is global. Call once, under any validly-shaped ambient tenant with `platformScope` set. */
export async function seedPermissionCatalog(seeder: DemoDataSeeder): Promise<void> {
  await seeder.seedPermissionCatalog();
}

/** One tenant's worth of B9 tab 3 (seeded roles + grants) and tab 2 (its one sample team). Call under `runWithTenant({ tenant: demoTenant.slug, ... })`. Returns the team's id. */
export async function seedTenantRolesAndTeam(
  seeder: DemoDataSeeder,
  tenant: DemoTenant,
): Promise<string> {
  await seeder.seedSeededRolesAndGrants(tenant.slug);
  return seeder.ensureTeam(tenant.slug, tenant.team);
}

/** One staff user's `platform.StaffUsers` row + home-tenant membership. Platform-scoped — call under any validly-shaped ambient tenant with `platformScope` set. Returns the staff user's id. */
export async function seedStaffUser(seeder: DemoDataSeeder, user: DemoStaffUser): Promise<string> {
  return seeder.ensureStaffUser({
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    homeTenant: user.tenant,
  });
}

/** One user's team membership + role assignment **in one specific tenant**. Call under `runWithTenant({ tenant, ... })` for that same tenant. */
export async function seedUserMembershipAndRole(
  seeder: DemoDataSeeder,
  tenant: TenantSlug,
  staffUserId: string,
  teamId: string,
  roleKey: string,
): Promise<void> {
  await seeder.ensurePrimaryTeamMembership(tenant, staffUserId, teamId);
  await seeder.ensureRoleAssignment(tenant, staffUserId, roleKey);
}
