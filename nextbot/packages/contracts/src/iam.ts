import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/** LLD §3.3 `RbacModule` — the fixed set of RBAC-gated modules in the Admin Console. */
export const RbacModule = Type.Union([
  Type.Literal("channels"),
  Type.Literal("connectors"),
  Type.Literal("tool_permissions"),
  Type.Literal("agent_tool_config"),
  Type.Literal("approval_queue"),
  Type.Literal("escalations"),
  Type.Literal("conversations"),
  Type.Literal("reporting"),
  Type.Literal("a2a_config"),
  Type.Literal("agent_platform"),
  Type.Literal("designer"),
  Type.Literal("security_settings"),
  Type.Literal("audit_log"),
  Type.Literal("users_roles"),
  Type.Literal("developer_portal"),
  // Target Architecture Blueprint Phase 7b (BL-38, blueprint §5.2 — two new,
  // deliberately separate modules): "knowledge" gates collections/sources CRUD,
  // ingestion status, and generations; "knowledge_config" gates the narrower
  // embedding/rerank model choice and chunking/extraction policy fields — split so
  // a curator can add sources without being able to change retrieval behavior.
  Type.Literal("knowledge"),
  Type.Literal("knowledge_config"),
]);
export type RbacModuleValue = Static<typeof RbacModule>;
export const RBAC_MODULES = RbacModule.anyOf.map((l) => l.const) as RbacModuleValue[];

export const PermissionLevel = Type.Union([
  Type.Literal("None"),
  Type.Literal("Read"),
  Type.Literal("Write"),
]);
export type PermissionLevelValue = Static<typeof PermissionLevel>;

export const PermissionMatrixSchema = Type.Record(RbacModule, PermissionLevel);
export type PermissionMatrix = Static<typeof PermissionMatrixSchema>;

/** A permission level ordering used by `hasAtLeast()` — None < Read < Write. */
export const PERMISSION_RANK: Record<PermissionLevelValue, number> = { None: 0, Read: 1, Write: 2 };

export const LoginRequestSchema = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 1 }),
  tenantSlug: Type.String({ minLength: 1 }),
});
export type LoginRequest = Static<typeof LoginRequestSchema>;

export const MfaChallengeRequestSchema = Type.Object({
  challengeToken: Type.String({ minLength: 1 }),
  code: Type.String({ minLength: 6, maxLength: 10 }),
});
export type MfaChallengeRequest = Static<typeof MfaChallengeRequestSchema>;

/** QA Defect B3 — confirms a forced-enrollment token (see `login()`'s
 * `mfa_enrollment_required` outcome) with the first TOTP code from the newly
 * enrolled authenticator app. */
export const MfaEnrollmentConfirmRequestSchema = Type.Object({
  enrollmentToken: Type.String({ minLength: 1 }),
  code: Type.String({ minLength: 6, maxLength: 10 }),
});
export type MfaEnrollmentConfirmRequest = Static<typeof MfaEnrollmentConfirmRequestSchema>;

export const CreateRoleRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  permissionMatrix: PermissionMatrixSchema,
  // QA Defect B3 (FR-SEC-03/ADR-0002 §4.2): optional per-role MFA enforcement flag.
  mfaRequired: Type.Optional(Type.Boolean()),
});
export type CreateRoleRequest = Static<typeof CreateRoleRequestSchema>;

/** `PUT /api/v1/admin/roles/{id}` — edits a *custom* (non-system) role's name/matrix/
 * MFA flag. System roles are rejected server-side (`SystemRoleImmutableError`) — this
 * schema doesn't distinguish, the check is a runtime lookup, not a payload shape. */
export const UpdateRoleRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  permissionMatrix: PermissionMatrixSchema,
  mfaRequired: Type.Optional(Type.Boolean()),
});
export type UpdateRoleRequest = Static<typeof UpdateRoleRequestSchema>;

/**
 * Completes the "Users & Roles" admin screen (FR-ADM-02 / screen inventory B.8.1):
 * creates an Admin Console user with one or more role assignments up front — this is
 * the "invite" flow's request shape. `roleIds` requires at least one entry, mirroring
 * FR-ADM-02's fail-closed rule at creation time rather than allowing a role-less user
 * to be created and discovering the lockout only at their first login attempt.
 */
export const CreateUserRequestSchema = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
  displayName: Type.String({ minLength: 1, maxLength: 200 }),
  roleIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1 }),
});
export type CreateUserRequest = Static<typeof CreateUserRequestSchema>;

/** `PUT /api/v1/admin/users/{id}/roles` — replaces a user's entire role assignment
 * set (role-reassignment, not incremental add/remove) with `roleIds`. At least one
 * role required (same fail-closed rule as creation). */
export const UpdateUserRolesRequestSchema = Type.Object({
  roleIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1 }),
});
export type UpdateUserRolesRequest = Static<typeof UpdateUserRolesRequestSchema>;

// ---------------------------------------------------------------------------
// Domain errors (FR-SEC-03 / FR-ADM-02). LLD §11.2 error table §Error codes.
// ---------------------------------------------------------------------------

/** Bad email/password. Deliberately worded identically regardless of whether the
 * email exists, so the response cannot be used to enumerate accounts. */
export class InvalidCredentialsError extends DomainError {
  readonly code = "INVALID_CREDENTIALS";
  readonly httpStatus = 401;
  constructor() {
    super("Incorrect email or password.");
  }
}

/**
 * FR-SEC-03: the account is locked from too many failed attempts. Deliberately a
 * **distinct** message from `InvalidCredentialsError` per the spec's explicit
 * requirement, so a locked-out legitimate user isn't told "wrong password" and left
 * guessing why a correct password keeps failing.
 */
export class AccountLockedError extends DomainError {
  readonly code = "ACCOUNT_LOCKED";
  readonly httpStatus = 423;
  constructor(retryAfterSeconds: number) {
    super(
      `Too many failed sign-in attempts. Your account is temporarily locked — try again in ${Math.ceil(
        retryAfterSeconds / 60,
      )} minute(s).`,
    );
  }
}

/** FR-ADM-02 fail-closed: a real credential match with zero assigned roles. */
export class AuthNoRoleAssignedError extends DomainError {
  readonly code = "AUTH_NO_ROLE_ASSIGNED";
  readonly httpStatus = 403;
  constructor() {
    super("Your account has no assigned role — contact your administrator.");
  }
}

export class MfaRequiredError extends DomainError {
  readonly code = "MFA_REQUIRED";
  readonly httpStatus = 401;
  constructor(readonly challengeToken: string) {
    super("Multi-factor authentication is required to complete sign-in.");
  }
}

export class MfaChallengeInvalidError extends DomainError {
  readonly code = "MFA_CHALLENGE_INVALID";
  readonly httpStatus = 401;
  constructor() {
    super("That verification code is invalid or has expired.");
  }
}

export class RoleNameDuplicateError extends DomainError {
  readonly code = "ROLE_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A role named '${name}' already exists.`);
  }
}

/** A system (seeded) role's name/permission matrix/MFA flag cannot be edited, and it
 * cannot be deleted — the six seeded roles (Tenant Admin, Backend System Owner,
 * Designer, Platform Engineer, Escalation Agent, Read-Only) are the tenant's baseline
 * and are only ever created by `seedSystemRoles()` at provisioning time. */
export class SystemRoleImmutableError extends DomainError {
  readonly code = "SYSTEM_ROLE_IMMUTABLE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`'${name}' is a system role and cannot be edited.`);
  }
}

export class RoleNotFoundInTenantError extends DomainError {
  readonly code = "ROLE_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("That role does not exist.");
  }
}

export class UserNotFoundInTenantError extends DomainError {
  readonly code = "USER_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("That user does not exist.");
  }
}

/** One or more `roleIds` in a create/reassignment request don't resolve to a role in
 * the caller's tenant — kept distinct from `RoleNotFoundInTenantError` (singular,
 * name-based) since this is the id-array-based assignment path's own validation. */
export class InvalidRoleAssignmentError extends DomainError {
  readonly code = "INVALID_ROLE_ASSIGNMENT";
  readonly httpStatus = 422;
  constructor() {
    super("One or more selected roles do not exist.");
  }
}

/** RBAC matrix denial — the body names the module the caller lacks access to. */
export class ForbiddenModuleError extends DomainError {
  readonly code = "FORBIDDEN_MODULE";
  readonly httpStatus = 403;
  constructor(readonly module: RbacModuleValue, readonly required: PermissionLevelValue) {
    super(`You do not have ${required} access to '${module}'.`);
  }
}

export class SessionInvalidError extends DomainError {
  readonly code = "SESSION_INVALID";
  readonly httpStatus = 401;
  constructor() {
    super("Your session is invalid or has expired. Please sign in again.");
  }
}

// ---------------------------------------------------------------------------
// Phase 4 (BL-36, FR-SEC-10): SSO (SAML/OIDC), SCIM, session management,
// service accounts + scoped API keys.
// ---------------------------------------------------------------------------

export const SsoProtocol = Type.Union([Type.Literal("Saml"), Type.Literal("Oidc")]);
export type SsoProtocolValue = Static<typeof SsoProtocol>;

/** `PUT /api/v1/admin/sso/connection` — creates/replaces the tenant's single SSO
 * connection. The two protocol-specific field groups are optional at the schema
 * level; `application/sso-connection.ts` enforces "the fields the chosen protocol
 * needs are present" since TypeBox's discriminated unions don't compose cleanly
 * with this module's existing flat-object convention. */
export const UpsertSsoConnectionRequestSchema = Type.Object({
  protocol: SsoProtocol,
  displayName: Type.String({ minLength: 1, maxLength: 200 }),
  jitProvisioningEnabled: Type.Optional(Type.Boolean()),
  defaultRoleId: Type.Optional(Type.String({ format: "uuid" })),
  groupClaimName: Type.Optional(Type.String({ maxLength: 100 })),
  oidcIssuerUrl: Type.Optional(Type.String({ format: "uri" })),
  oidcClientId: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  oidcClientSecret: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  samlEntryPoint: Type.Optional(Type.String({ format: "uri" })),
  samlIssuer: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  samlIdpCertificate: Type.Optional(Type.String({ minLength: 1 })),
});
export type UpsertSsoConnectionRequest = Static<typeof UpsertSsoConnectionRequestSchema>;

export const UpdateSsoConnectionStatusRequestSchema = Type.Object({
  status: Type.Union([Type.Literal("Active"), Type.Literal("Disabled")]),
});
export type UpdateSsoConnectionStatusRequest = Static<typeof UpdateSsoConnectionStatusRequestSchema>;

export const CreateServiceAccountRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  roleIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1 }),
});
export type CreateServiceAccountRequest = Static<typeof CreateServiceAccountRequestSchema>;

/** `scopeMatrix`, if supplied, must never grant a level the service account's own
 * role-derived matrix doesn't already have — enforced server-side
 * (`application/service-account.ts`), not merely by this shape. */
export const IssueApiKeyRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  scopeMatrix: Type.Optional(PermissionMatrixSchema),
  expiresAt: Type.Optional(Type.String({ format: "date-time" })),
});
export type IssueApiKeyRequest = Static<typeof IssueApiKeyRequestSchema>;

export class SsoNotConfiguredError extends DomainError {
  readonly code = "SSO_NOT_CONFIGURED";
  readonly httpStatus = 404;
  constructor() {
    super("Single sign-on is not configured for this tenant.");
  }
}

/** Fail-closed per FR-SEC-10's brief: any SAML/OIDC validation failure (bad
 * signature, expired assertion, audience/issuer mismatch, IdP unreachable,
 * malformed response) maps to this single, generic, non-enumerable error —
 * never a distinct message per failure reason, mirroring `InvalidCredentialsError`'s
 * anti-enumeration rationale for the password path. */
export class SsoAuthenticationFailedError extends DomainError {
  readonly code = "SSO_AUTHENTICATION_FAILED";
  readonly httpStatus = 401;
  constructor() {
    super("Single sign-on authentication failed. Contact your administrator if this continues.");
  }
}

/** README decision #1: JIT provisioning disabled and no pre-existing invited user
 * matches the IdP-asserted email. */
export class SsoUserNotProvisionedError extends DomainError {
  readonly code = "SSO_USER_NOT_PROVISIONED";
  readonly httpStatus = 403;
  constructor() {
    super("Your account has not been provisioned for single sign-on. Contact your administrator.");
  }
}

/** NFR-17: SSO/SCIM is an Enterprise-tier capability. */
export class SsoPlanTierNotEligibleError extends DomainError {
  readonly code = "SSO_PLAN_TIER_NOT_ELIGIBLE";
  readonly httpStatus = 403;
  constructor() {
    super("Single sign-on and SCIM provisioning require the Enterprise plan tier.");
  }
}

export class ScimAuthenticationFailedError extends DomainError {
  readonly code = "SCIM_AUTHENTICATION_FAILED";
  readonly httpStatus = 401;
  constructor() {
    super("Invalid or missing SCIM bearer token.");
  }
}

export class ScimUserNotFoundError extends DomainError {
  readonly code = "SCIM_USER_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("Resource not found.");
  }
}

export class ScimConflictError extends DomainError {
  readonly code = "SCIM_CONFLICT";
  readonly httpStatus = 409;
  constructor() {
    super("A user with this externalId/userName already exists.");
  }
}

export class SessionNotFoundError extends DomainError {
  readonly code = "SESSION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("That session does not exist.");
  }
}

export class ServiceAccountNotFoundError extends DomainError {
  readonly code = "SERVICE_ACCOUNT_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("That service account does not exist.");
  }
}

/** A `scopeMatrix` entry attempts to grant a level the service account's own
 * role-derived matrix does not have — narrowing only, never widening. */
export class ApiKeyScopeExceedsAccountError extends DomainError {
  readonly code = "API_KEY_SCOPE_EXCEEDS_ACCOUNT";
  readonly httpStatus = 422;
  constructor() {
    super("An API key's permission scope cannot exceed the service account's own assigned permissions.");
  }
}

export class ApiKeyInvalidError extends DomainError {
  readonly code = "API_KEY_INVALID";
  readonly httpStatus = 401;
  constructor() {
    super("Invalid, expired, or revoked API key.");
  }
}
