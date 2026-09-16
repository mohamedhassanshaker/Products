"use server";

/**
 * Server Actions for `/iam` (B9) — every write on this screen.
 *
 * Every action requires `users:manage`, matching B9 tab 3's own matrix: `RESTRICTED_
 * PERMISSIONS["users:manage"]` names only Super Admin, and B9's own wireframe rule is that
 * this whole screen ("Users, teams & roles") is the one that determines what every other
 * screen permits — there is no narrower permission for "manage teams" or "manage roles"
 * distinct from "manage users & teams" in the seeded matrix, so this route does not invent
 * one. Checked here, the caller, per api.md §12 invariant 2 (the use case itself does not
 * check it) — the same convention `settings/appearance/actions.ts` already established for
 * `appearance:manage`.
 *
 * Each action catches its own use case's thrown errors and returns a structured
 * `{ ok: false, error }` rather than letting them surface as Next's generic unhandled
 * Server Action error overlay — B9's own validation failures (an email already in use, an
 * unknown role key) are expected, user-facing outcomes, not server faults.
 */

import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { CreateCustomRole } from "../../../../modules/iam/application/create-custom-role.js";
import { CreateTeam } from "../../../../modules/iam/application/create-team.js";
import { EditUser } from "../../../../modules/iam/application/edit-user.js";
import { InviteUser } from "../../../../modules/iam/application/invite-user.js";
import { ReactivateUser } from "../../../../modules/iam/application/reactivate-user.js";
import { RemoveUser } from "../../../../modules/iam/application/remove-user.js";
import { SuspendUser } from "../../../../modules/iam/application/suspend-user.js";
import { UpdateRolePermissions } from "../../../../modules/iam/application/update-role-permissions.js";
import { GetSecurityPolicy } from "../../../../modules/iam/application/get-security-policy.js";
import { UpdateSecurityPolicy } from "../../../../modules/iam/application/update-security-policy.js";
import type { UpdateSecurityPolicyResult } from "../../../../modules/iam/application/update-security-policy.js";
import { ResetStaffTotp } from "../../../../modules/iam/application/reset-staff-totp.js";
import type { SecurityPolicyRow } from "../../../../modules/iam/ports/security-policy-repository.js";
import type {
  RolePermissionChange,
  UpdatePermissionsResult,
} from "../../../../modules/iam/ports/role-repository.js";
import type { TeamScope } from "../../../../modules/iam/ports/team-repository.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import {
  environment,
  identityProvider,
  realClock,
  roleRepository,
  securityPolicyRepository,
  sessionStore,
  teamRepository,
  userRepository,
} from "./composition.js";

const MANAGE_PERMISSION = "users:manage" as const;
const SECURITY_PERMISSION = "security:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function inviteUserAction(input: {
  readonly email: string;
  readonly displayName: string;
}): Promise<ActionResult<{ readonly staffUserId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.inviteUser");
        const result = await new InviteUser({
          users: userRepository(),
          clock: realClock(),
        }).execute({
          email: input.email,
          displayName: input.displayName,
          tenant: principal.tenant,
          invitedByStaffUserId: principal.id,
          environment: environment(),
        });
        return { ok: true, value: { staffUserId: result.user.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function editUserAction(input: {
  readonly staffUserId: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly teamIds?: readonly string[];
  readonly roleKeys?: readonly string[];
}): Promise<ActionResult<{ readonly staffUserId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.editUser");
        const result = await new EditUser({
          users: userRepository(),
          teams: teamRepository(),
        }).execute({
          staffUserId: input.staffUserId,
          tenant: principal.tenant,
          actorId: principal.id,
          environment: environment(),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.teamIds !== undefined ? { teamIds: input.teamIds } : {}),
          ...(input.roleKeys !== undefined ? { roleKeys: input.roleKeys } : {}),
        });
        return { ok: true, value: { staffUserId: result.user.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function suspendUserAction(
  staffUserId: string,
): Promise<ActionResult<{ readonly sessionsRevoked: number }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.suspendUser");
        const result = await new SuspendUser({
          users: userRepository(),
          sessions: sessionStore(),
          clock: realClock(),
        }).execute({ staffUserId, actorId: principal.id, environment: environment() });
        return { ok: true, value: { sessionsRevoked: result.sessionsRevoked } } as const;
      },
      { method: "POST", body: { staffUserId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function reactivateUserAction(
  staffUserId: string,
): Promise<ActionResult<{ readonly staffUserId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.reactivateUser");
        await new ReactivateUser({ users: userRepository(), clock: realClock() }).execute({
          staffUserId,
          actorId: principal.id,
          environment: environment(),
        });
        return { ok: true, value: { staffUserId } } as const;
      },
      { method: "POST", body: { staffUserId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function removeUserAction(
  staffUserId: string,
): Promise<ActionResult<{ readonly sessionsRevoked: number }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.removeUser");
        const result = await new RemoveUser({
          users: userRepository(),
          sessions: sessionStore(),
        }).execute({
          staffUserId,
          tenant: principal.tenant,
          actorId: principal.id,
          environment: environment(),
        });
        return { ok: true, value: { sessionsRevoked: result.sessionsRevoked } } as const;
      },
      { method: "POST", body: { staffUserId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createTeamAction(input: {
  readonly name: string;
  readonly scope: TeamScope;
  readonly description?: string;
}): Promise<ActionResult<{ readonly teamId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.createTeam");
        const result = await new CreateTeam({ teams: teamRepository() }).execute({
          name: input.name,
          scope: input.scope,
          ...(input.description !== undefined ? { description: input.description } : {}),
          createdByStaffUserId: principal.id,
        });
        return { ok: true, value: { teamId: result.team.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createCustomRoleAction(input: {
  readonly displayName: string;
  readonly description?: string;
}): Promise<ActionResult<{ readonly roleId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.createCustomRole");
        const result = await new CreateCustomRole({ roles: roleRepository() }).execute({
          displayName: input.displayName,
          ...(input.description !== undefined ? { description: input.description } : {}),
          createdByStaffUserId: principal.id,
        });
        return { ok: true, value: { roleId: result.role.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * The team ids and role keys one user currently holds **in this tenant** — everything B9
 * tab 1's Edit dialog needs to pre-select the right "team pills"/"role pills" before the
 * user touches anything. `ListUsers`' own roster row deliberately carries only display
 * strings (`primaryTeamName`/`roleDisplayNames`, what the *table* renders) — the Edit
 * dialog needs the underlying ids/keys instead, which is a different enough shape that
 * duplicating it onto the roster row would mean fetching data every row never uses just to
 * serve the one row currently being edited. A small, separate, on-demand read instead.
 */
export async function loadUserEditContextAction(
  staffUserId: string,
): Promise<
  ActionResult<{ readonly teamIds: readonly string[]; readonly roleKeys: readonly string[] }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "iam.loadUserEditContext");
        const [memberships, roleKeys] = await Promise.all([
          teamRepository().listMemberships(),
          userRepository().rolesFor(staffUserId, principal.tenant),
        ]);
        const teamIds = memberships
          .filter((membership) => membership.staffUserId === staffUserId)
          // Primary first, matching `TeamRepository.setMemberships`'s own "teamIds[0]
          // becomes the primary" contract — re-submitting this exact order is a no-op.
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
          .map((membership) => membership.teamId);
        return { ok: true, value: { teamIds, roleKeys } } as const;
      },
      { method: "POST", body: { staffUserId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * `PermissionMatrix`'s own `onCellsChange` seam (B9 tab 3) — the real persistence a single
 * cell toggle, a `Shift+Space` row toggle, a `Ctrl+Space` column toggle, or a `Ctrl+Z` undo
 * all call through, one batch of changes at a time. Returns the real `UpdatePermissionsResult`
 * (including the `{ ok: false, reason: "protected" }` shape) directly — the caller (`roles-
 * tab.tsx`) is what decides how to surface a protected-cell rejection; this action does not
 * collapse it into a generic string error the way the other actions above do, because the
 * matrix UI needs the structured shape to know *which* cell to visually revert.
 */
export async function updateRolePermissionsAction(
  changes: readonly RolePermissionChange[],
): Promise<UpdatePermissionsResult> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "iam.updateRolePermissions");
      return new UpdateRolePermissions({ roles: roleRepository() }).execute({
        changes,
        actorId: principal.id,
      });
    },
    { method: "POST", body: { changes } },
  );
}

// ---------------------------------------------------------------------------
// Security tab (new, B9) — session/lockout policy and TOTP administration.
// Gated by `security:manage`, a separate permission from this file's other actions'
// `users:manage` — see `domain/permissions.ts`'s own doc comment for why.
// ---------------------------------------------------------------------------

export async function loadSecurityPolicyAction(): Promise<ActionResult<SecurityPolicyRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, SECURITY_PERMISSION, "iam.loadSecurityPolicy");
        const policy = await new GetSecurityPolicy({
          securityPolicy: securityPolicyRepository(),
        }).execute({ now: realClock().now() });
        return { ok: true, value: policy } as const;
      },
      { method: "POST", body: {} },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateSecurityPolicyAction(input: {
  readonly staffSessionIdleMinutes: number;
  readonly staffSessionAbsoluteHours: number;
  readonly lockoutFailuresBeforeLock: number;
  readonly lockoutDurationMinutes: number;
  readonly backoffCeilingSeconds: number;
}): Promise<ActionResult<UpdateSecurityPolicyResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, SECURITY_PERMISSION, "iam.updateSecurityPolicy");
        const result = await new UpdateSecurityPolicy({
          securityPolicy: securityPolicyRepository(),
        }).execute({
          ...input,
          updatedByStaffUserId: principal.id,
          now: realClock().now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** `staffUserId -> has a second factor enrolled` — the Security tab's TOTP list, re-read after any reset so the row updates without a full page reload. */
export async function listTotpStatusAction(
  staffUserIds: readonly string[],
): Promise<ActionResult<Readonly<Record<string, boolean>>>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, SECURITY_PERMISSION, "iam.listTotpStatus");
        const statusByUserId = await identityProvider().listTotpEnrolmentStatus(staffUserIds);
        return { ok: true, value: Object.fromEntries(statusByUserId) } as const;
      },
      { method: "POST", body: { staffUserIds } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function resetStaffTotpAction(input: {
  readonly staffUserId: string;
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, SECURITY_PERMISSION, "iam.resetStaffTotp");
        await new ResetStaffTotp({ identity: identityProvider() }).execute({
          staffUserId: input.staffUserId,
          now: realClock().now(),
        });
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
