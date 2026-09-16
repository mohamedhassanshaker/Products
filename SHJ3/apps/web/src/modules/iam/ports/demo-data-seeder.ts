/**
 * Deterministic demo-data seeding — closes the long-standing, separately-tracked B-0 open
 * item ("deterministic seed data matching the wireframe's sample state") from inside B-2,
 * since IAM data (users/teams/roles) is the natural home for it.
 *
 * A dedicated port, not a reuse of `UserRepository`/`TeamRepository`/`RoleRepository`,
 * because seeding needs operations B9's own screens must never expose: `RoleRepository.
 * createCustomRole` always creates a role with `isSystem: false` (correctly — it is B9 tab
 * 3's "+ Add custom role" action, and a custom role must never masquerade as one of the 7
 * seeded ones), but seeding the 7 seeded roles themselves needs `isSystem: true`. Same
 * reasoning for `platform.Permissions` (never written by any ordinary screen — B9 tab 3's
 * catalog is code-defined, `domain/permissions.ts`'s `PERMISSION_CATALOG`) and for setting a
 * staff user directly to `Active`/`Suspended` without the normal invite-and-sign-in path a
 * real `InviteUser` use case requires.
 *
 * Every method is idempotent at the finest reasonable grain (checked before written), so a
 * crashed or partial prior run is safely resumed by re-running the whole script — matching
 * `seed-system-skins.ts`'s own precedent.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { StaffUserStatus } from "../ports/user-repository.js";
import type { TeamScope } from "../ports/team-repository.js";

export interface DemoDataSeeder {
  /** `platform.Permissions` — the 9-row, code-defined catalog (`domain/permissions.ts`'s `PERMISSION_CATALOG`). Global, seeded once regardless of tenant count. */
  seedPermissionCatalog(): Promise<void>;

  /**
   * The 7 seeded roles (`domain/permissions.ts`'s `SEEDED_ROLES`/`ROLE_KEYS`) and their
   * `RolePermission` grants (`SEEDED_ROLE_PERMISSIONS`) for one tenant — `isSystem: true`,
   * `ordinal` matching `SEEDED_ROLES`' own array order (fixing B9 tab 3's matrix column
   * order, per `Role.ordinal`'s own doc comment).
   */
  seedSeededRolesAndGrants(tenant: TenantSlug): Promise<void>;

  /**
   * Create-or-find a `StaffUser` by email, set it directly to the given status (bypassing
   * the normal invite-then-accept path — legitimate here, since this is bootstrap fixture
   * data, not a live invitation), and grant membership to `tenant` (the account's
   * `homeTenant`). Returns the staff user's id.
   */
  ensureStaffUser(input: {
    readonly email: string;
    readonly displayName: string;
    readonly status: StaffUserStatus;
    readonly homeTenant: TenantSlug;
  }): Promise<string>;

  /** Create-or-find a team by (tenant, name). Returns its id. */
  ensureTeam(
    tenant: TenantSlug,
    input: { readonly name: string; readonly scope: TeamScope },
  ): Promise<string>;

  /** Set a staff user's sole, primary team membership in `tenant` to exactly this team — matches `TeamRepository.setMemberships([teamId])`'s own semantics, reused for the idempotent "set exactly this" case a seed script needs. */
  ensurePrimaryTeamMembership(
    tenant: TenantSlug,
    staffUserId: string,
    teamId: string,
  ): Promise<void>;

  /** Assign exactly this one role (by key) to a staff user in `tenant`, idempotently. */
  ensureRoleAssignment(tenant: TenantSlug, staffUserId: string, roleKey: string): Promise<void>;
}
