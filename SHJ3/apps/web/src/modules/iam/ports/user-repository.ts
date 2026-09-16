/**
 * Staff user, role and permission-matrix persistence.
 *
 * This port is what survives an SSO migration. It describes the *application's*
 * view of a staff principal — status, home tenant, roles, session epoch — none of
 * which is the identity provider's business. `LocalCredential` (see
 * `credential-repository.ts`) is the throwaway half; this half stays.
 *
 * The split matters for ADR-0006 rule 3. When Entra ID or Keycloak lands,
 * `StaffCredentials` is dropped and *this* port is untouched, because none of it
 * describes how anyone proves who they are.
 *
 * ## Why the matrix is read through a port and not compiled in
 *
 * Every cell in B9 tab 3 is a runtime toggle, and api.md §3.1 requires a matrix
 * edit to take effect on the next request rather than the next login. So the
 * matrix is data, read per request, and `SEEDED_ROLE_PERMISSIONS` in
 * `domain/permissions.ts` is only the provisioning seed. A port here is what
 * keeps that testable without a database.
 *
 * ## B-2 additions: `listForTenant` / `create` / `updateProfile` /
 * `setRoleAssignments` / `revokeTenantMembership`
 *
 * The methods above this comment are exactly what a previous wave built and
 * `sign-in`/`resolve-session`/`suspend-user` already depend on — untouched. B9 tab 1
 * needs a full roster and CRUD, which nothing here offered yet, so B-2 adds it rather
 * than reaching around this port from the application layer.
 *
 * **"Remove" is `TenantMembership.revokedAt`, not `StaffUsers.deletedAt`.** Found by
 * reading the schema directly rather than assumed: `StaffUsers.status` is explicitly
 * "a status transition, never a deletion" (its own doc comment) — yet the same model
 * *also* carries a `deletedAt` column, and `UQ_StaffUsers_email` is filtered on it. A
 * global soft-delete would suspend the person's access to *every* tenant they belong
 * to from *one* tenant's IAM screen, which B9's own scoping (one entity's own admin
 * screen) does not ask for and `TenantMembership.revokedAt` already exists to express
 * more precisely: "no longer on this entity's roster," leaving any other tenant's
 * membership untouched. `StaffUsers.deletedAt` stays real and unused by this wave — a
 * genuinely different, broader operation ("delete this person's account everywhere")
 * that B9's wireframe never asks for, flagged here rather than silently repurposed.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { Permission } from "../domain/permissions.js";

/**
 * B9 tab 1's three states. A status transition, never a deletion — a suspended
 * user still owns audit entries, published agents and escalation history.
 *
 * Global, not per-tenant (`StaffUsers.status` carries one value): B9's own wireframe
 * scopes Suspend/Reactivate this way — a serious, whole-person action distinct from
 * `revokeTenantMembership`'s narrower "remove from this entity's roster" (see the
 * module comment).
 */
export type StaffUserStatus = "Invited" | "Active" | "Suspended";

/**
 * The staff user record, as the application is allowed to see it.
 *
 * Note the absence: no password hash, no TOTP secret, no lockout counters. They
 * are not omitted from this interface as a courtesy — they are in a different
 * table with a narrower grant, so a per-tenant export or a user listing
 * *physically cannot* include them (ADR-0006 rule 3).
 */
export interface StaffUser {
  readonly id: string;
  /** Stored and compared lowercased, so `Sara@shj.ae` and `sara@shj.ae` are one account. */
  readonly email: string;
  readonly displayName: string;
  readonly status: StaffUserStatus;
  readonly homeTenant: TenantSlug;
  /**
   * Bumped to invalidate every live session for this principal. Read on every
   * request and compared against the session's copy, so a bump fails even a
   * request already in flight on another pod.
   */
  readonly sessionEpoch: number;
}

/**
 * A status change and its audit entry, together.
 *
 * api.md §12 invariant 3: the audit entry is written **in the same database
 * transaction** as the change it audits — not after, not by a listener, not on a
 * queue. Passing them as one argument is how that invariant becomes expressible
 * in the port instead of a rule the adapter is asked to remember: there is no
 * method here that changes a status without an audit entry.
 */
export interface AuditedStatusChange {
  readonly staffUserId: string;
  readonly status: StaffUserStatus;
  readonly at: Date;
  readonly audit: {
    readonly actorId: string;
    readonly action: string;
    readonly environment: string;
    readonly detail?: Record<string, unknown>;
  };
}

/** Common audit shape for the B-2 write methods below — same trio every use case already supplies `SuspendUser`. */
export interface AuditContext {
  readonly actorId: string;
  readonly action: string;
  readonly environment: string;
  readonly detail?: Record<string, unknown>;
}

export interface NewStaffUser {
  readonly email: string;
  readonly displayName: string;
  readonly invitedByStaffUserId: string;
  readonly at: Date;
}

export interface ProfileEdit {
  readonly displayName?: string;
  readonly email?: string;
}

export interface UserRepository {
  /** Lowercases the identifier before lookup. Returns null for an unknown address, or one whose account has been (globally) removed. */
  findByEmail(email: string): Promise<StaffUser | null>;

  findById(staffUserId: string): Promise<StaffUser | null>;

  /**
   * The roles this user holds **in this tenant** (`UserRoleAssignments`).
   *
   * Per tenant, not global: the same person may be a Reviewer in one government
   * entity and an Entity Admin in another, and flattening that would grant the
   * union everywhere.
   */
  rolesFor(staffUserId: string, tenant: TenantSlug): Promise<readonly string[]>;

  /**
   * The tenant's live 7×N matrix, keyed by role name.
   *
   * Includes custom roles added through B9 tab 3's **+ Add custom role**, which
   * start with every permission off. A role absent from the returned record
   * contributes nothing — `resolvePermissions` treats absence as deny, so a role
   * deleted while a session is live reduces access rather than escalating it.
   */
  permissionMatrix(tenant: TenantSlug): Promise<Readonly<Record<string, readonly Permission[]>>>;

  /** The tenants this user may bind a session to (`TenantMemberships`, unrevoked). */
  membershipsFor(staffUserId: string): Promise<readonly TenantSlug[]>;

  /** Status change plus audit entry, atomically. See `AuditedStatusChange`. */
  changeStatus(change: AuditedStatusChange): Promise<void>;

  /**
   * Increment `StaffUsers.sessionEpoch` and return the new value.
   *
   * Called on suspension and on password rotation. Returning the new value lets
   * the caller assert the bump actually happened rather than assuming it.
   */
  bumpSessionEpoch(staffUserId: string): Promise<number>;

  recordSuccessfulLogin(staffUserId: string, at: Date): Promise<void>;

  // -------------------------------------------------------------------------
  // B-2 additions — B9 tab 1's roster and CRUD.
  // -------------------------------------------------------------------------

  /** Every staff user with an unrevoked `TenantMembership` to `tenant` — B9 tab 1's roster, ordered by display name. */
  listForTenant(tenant: TenantSlug): Promise<readonly StaffUser[]>;

  /**
   * B9 tab 1's **+ Invite user** — enters as `Invited` (`CK_StaffUsers_invitedHasNoLogin`).
   *
   * If `email` already belongs to a live `StaffUser` (they work with another entity
   * already — "one email is one account across the whole backoffice", ADR-0006 rule
   * 3), this grants that existing account membership to `tenant` rather than
   * rejecting the invite or creating a duplicate row; a genuinely new email creates a
   * fresh `Invited` account. Either way, the returned record and the new
   * `TenantMembership` are one atomic write, and this tenant's membership is
   * `isPrimary` only when the account has no other membership yet.
   */
  create(input: NewStaffUser, tenant: TenantSlug): Promise<StaffUser>;

  /** B9 tab 1's Edit dialog — name/email fields. Rejects (loudly, not silently) an email already in use by a different live account. */
  updateProfile(staffUserId: string, edit: ProfileEdit, audit: AuditContext): Promise<StaffUser>;

  /**
   * Replace a user's role assignments **in this tenant** with exactly this set of
   * `Role.key` values — B9 tab 1's Edit dialog's plural "role pills". Writes a real
   * audit entry recording the before/after role-key sets as JSON, since
   * `UserRoleAssignments` is hard-deleted and carries no history of its own
   * (`Role`'s own doc comment: "the audit entry records the before/after state as
   * JSON, not a foreign key, precisely so this can be deleted cleanly").
   */
  setRoleAssignments(
    staffUserId: string,
    tenant: TenantSlug,
    roleKeys: readonly string[],
    audit: AuditContext,
  ): Promise<void>;

  /**
   * B9 tab 1's **Remove** — see the module comment on why this revokes
   * `TenantMembership` rather than soft-deleting the global `StaffUser` row. Also
   * clears this tenant's `TeamMembers`/`UserRoleAssignments` for the user (both
   * hard-deleted, neither carries history — §1.4), all in one transaction with the
   * audit entry. Ending this tenant's live sessions is deliberately *not* this
   * method's job — that is `SessionStore.destroyAllForSubject` (already
   * tenant-prefixed), a Redis concern the *use case* (`remove-user.ts`) calls
   * separately, exactly mirroring `SuspendUser`'s own split between the SQL change
   * and the session store. Never bumps the global `sessionEpoch`, which would
   * incorrectly end the user's sessions in every *other* tenant they still belong to.
   */
  revokeTenantMembership(
    staffUserId: string,
    tenant: TenantSlug,
    audit: AuditContext,
  ): Promise<void>;
}
