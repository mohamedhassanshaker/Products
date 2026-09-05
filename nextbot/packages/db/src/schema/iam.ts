import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import {
  loginOutcomeEnum,
  mfaMethodEnum,
  ssoConnectionStatusEnum,
  ssoProtocolEnum,
  userKindEnum,
  userRoleSourceEnum,
  userStatusEnum,
} from "./enums.js";

/**
 * Shape of `role.permission_matrix` (LLD §3.3 `PermissionMatrixSchema`). Mirrored 1:1
 * by `packages/contracts/src/iam.ts`'s TypeBox schema (the runtime-validated source of
 * truth on write) — duplicated here only for Drizzle column type inference, same
 * convention as `TenantBrandingConfig` in `tenancy.ts`.
 */
export type RbacModule =
  | "channels"
  | "connectors"
  | "tool_permissions"
  | "agent_tool_config"
  | "approval_queue"
  | "escalations"
  | "conversations"
  | "reporting"
  | "a2a_config"
  | "agent_platform"
  | "designer"
  | "security_settings"
  | "audit_log"
  | "users_roles"
  | "developer_portal";

export type PermissionLevel = "None" | "Read" | "Write";
export type PermissionMatrix = Record<RbacModule, PermissionLevel>;

/**
 * **app_user** (LLD §3.3, BL-01). Credentials live directly on this RLS-protected,
 * tenant-scoped table (rather than a separate Better-Auth-owned table) — see
 * `packages/modules/iam/README.md` "Auth architecture decision" for why: Better
 * Auth's adapter model assumes a single long-lived DB client with no per-request
 * `SET LOCAL app.current_tenant` wrapping, which is incompatible with ADR-0001's
 * transaction-scoped RLS primitive without weakening the isolation guarantee for the
 * most sensitive table in the schema. This module implements Better Auth's feature
 * set natively against this table instead.
 */
export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    ssoSubject: text("sso_subject"),
    displayName: text("display_name").notNull(),
    status: userStatusEnum("status").notNull().default("Active"),
    mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),
    mfaMethod: mfaMethodEnum("mfa_method"),
    mfaSecretRef: text("mfa_secret_ref"),
    // QA Defect B2: holds a JSON-serialized array of `{ hash, usedAt }` entries (see
    // `application/mfa-backup-codes.ts`) — argon2id-hashed the same way passwords
    // are (never reversible), so there is no envelope-encryption/vault round trip to
    // do here (unlike `mfa_secret_ref`, which points at a genuinely decryptable
    // secret): a backup code is only ever compared by hash, never read back in
    // plaintext. Column name is a historical "_ref" but its content is the hashed
    // codes directly, not a vault pointer.
    mfaBackupCodesRef: text("mfa_backup_codes_ref"),
    // Phase 4 (BL-36, FR-SEC-10): 'ServiceAccount' rows are non-human, programmatic-
    // access-only identities — they reuse this same table/RBAC machinery rather than
    // a parallel identity model (see README's Phase 4 decision log #6). They never
    // have a password_hash/sso_subject and never appear in the human login flow.
    kind: userKindEnum("kind").notNull().default("Human"),
    failedLoginCount: smallint("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("app_user_tenant_email_key").on(t.tenantId, t.email),
    uniqueIndex("app_user_tenant_sso_subject_key").on(t.tenantId, t.ssoSubject),
    index("app_user_tenant_idx").on(t.tenantId),
  ],
);

/**
 * **role** (LLD §3.3). Six system roles are seeded per tenant at provisioning time:
 * Tenant Admin, Backend System Owner, Designer, Platform Engineer, Escalation Agent,
 * Read-Only (`packages/modules/iam/src/domain/system-roles.ts`).
 */
export const role = pgTable(
  "role",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    permissionMatrix: jsonb("permission_matrix").notNull().$type<PermissionMatrix>(),
    // QA Defect B3 (FR-SEC-03 / ADR-0002 §4.2): configurable per-role MFA
    // enforcement — a user holding a role with this set to true must complete MFA
    // enrollment before/immediately upon first login (see authenticate-user.ts's
    // `mfa_enrollment_required` login outcome), rather than MFA staying a purely
    // voluntary per-user opt-in indefinitely.
    mfaRequired: boolean("mfa_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("role_tenant_name_key").on(t.tenantId, t.name), index("role_tenant_idx").on(t.tenantId)],
);

/**
 * **user_role** (LLD §3.3). Composite PK `(tenant_id, user_id, role_id)`. FR-ADM-02
 * fail-closed rule: login succeeds only if `count(user_role) >= 1` for the user —
 * enforced in `application/authenticate-user.ts`, not just at the DB layer.
 *
 * `source` (Phase 4 retry, QA `20260829-054900` Finding 1): `Manual` for every
 * admin-console/SCIM/service-account grant (the pre-existing, intentionally-additive
 * behavior), `Sso` for a grant `sso-login.ts`'s `syncSsoRoleAssignment` derived from
 * the IdP's current group assertion. Only `Sso`-sourced rows are ever removed by SSO
 * login's re-derivation — a `Manual` grant is never touched by it, so an admin's
 * explicit console grant survives an IdP group change that doesn't happen to assert
 * a mapped group for it.
 */
export const userRole = pgTable(
  "user_role",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id),
    source: userRoleSourceEnum("source").notNull().default("Manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.roleId] }),
    index("user_role_tenant_user_idx").on(t.tenantId, t.userId),
  ],
);

/** **sso_group_mapping** (LLD §3.3) — maps an external IdP group claim to a role. */
export const ssoGroupMapping = pgTable(
  "sso_group_mapping",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    externalGroup: text("external_group").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sso_group_mapping_tenant_group_key").on(t.tenantId, t.externalGroup)],
);

/**
 * **login_attempt** (LLD §3.3, append-only). `tenant_id` is nullable because a login
 * attempt against an unknown email cannot always be resolved to a tenant (e.g. a
 * globally-unresolvable address) — see `authenticate-user.ts` for how this is still
 * kept RLS-safe (a NULL-tenant row is written via `withPlatform`, since no
 * `TenantContext` can exist yet for an unresolved identity).
 */
export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id"),
    email: text("email").notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    outcome: loginOutcomeEnum("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempt_tenant_email_created_idx").on(t.tenantId, t.email, t.createdAt)],
);

/**
 * **login_lockout_policy** — configurable per tenant (plan default: 5 attempts / 15 min
 * cooldown, per FR-SEC-03 / this dispatch's brief). Not in the original LLD table list;
 * added as a small local/reversible decision so the lockout thresholds are tenant-tunable
 * rather than hardcoded, mirroring how `tenant_runtime_quota` makes NFR-4a tunable.
 */
export const loginLockoutPolicy = pgTable("login_lockout_policy", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenant.id),
  maxFailedAttempts: integer("max_failed_attempts").notNull().default(5),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(15),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * **mfa_secret** — envelope-encrypted TOTP secret storage (FR-SEC-03: "no plaintext
 * MFA secret, vault_ref pointer only"). `app_user.mfa_secret_ref` holds the
 * `nb://<tenant>/mfa-secret/<id>` pointer to a row here; this is a dedicated table
 * (distinct from `connectors`' `credential` table) because MFA verification must
 * decrypt in-process inside `apps/web` at login time — unlike connector credentials,
 * which are only ever decrypted inside `apps/gateway` (LLD §3.5). See
 * `packages/modules/iam/README.md` for the full rationale.
 */
export const mfaSecret = pgTable("mfa_secret", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenant.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => appUser.id),
  ciphertext: text("ciphertext").notNull(),
  dekRef: text("dek_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * **sso_connection** (Phase 4, BL-36, FR-SEC-10). One row per tenant (unique
 * `tenant_id` — see README's decision log #2): the tenant's single SAML or OIDC
 * identity provider configuration. `status` starts `Disabled` and must be
 * explicitly flipped to `Active` by an admin after configuring it (fail-closed —
 * a half-configured connection never silently accepts logins).
 *
 * The OIDC client secret is envelope-encrypted the same way `mfa_secret` is
 * (ciphertext + dek_ref, decrypted in-process inside `apps/web` at
 * login/callback time — this flow never crosses into `apps/gateway`, so there is
 * no need for the `credential` table's restricted-grant treatment). The SAML IdP
 * certificate is a *public* key used only to verify inbound signatures, so it is
 * stored as plaintext PEM, not vaulted.
 */
export const ssoConnection = pgTable(
  "sso_connection",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    protocol: ssoProtocolEnum("protocol").notNull(),
    displayName: text("display_name").notNull(),
    status: ssoConnectionStatusEnum("status").notNull().default("Disabled"),
    // FR-ADM-02 / README decision #1: when true, a first-time SSO login creates a
    // new app_user row (JIT); when false, SSO login requires a pre-existing,
    // matching-email invited user.
    jitProvisioningEnabled: boolean("jit_provisioning_enabled").notNull().default(true),
    defaultRoleId: uuid("default_role_id").references(() => role.id),
    /** Which claim in the ID token / SAML attribute statement carries the group(s)
     * matched against `sso_group_mapping.external_group` (e.g. "groups"). */
    groupClaimName: text("group_claim_name"),
    // --- OIDC-only fields (NULL when protocol = 'Saml') ---
    oidcIssuerUrl: text("oidc_issuer_url"),
    oidcClientId: text("oidc_client_id"),
    oidcClientSecretCiphertext: text("oidc_client_secret_ciphertext"),
    oidcClientSecretDekRef: text("oidc_client_secret_dek_ref"),
    // --- SAML-only fields (NULL when protocol = 'Oidc') ---
    samlEntryPoint: text("saml_entry_point"),
    samlIssuer: text("saml_issuer"),
    samlIdpCertificate: text("saml_idp_certificate"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sso_connection_tenant_key").on(t.tenantId)],
);

/**
 * **auth_session** (Phase 4, BL-36, FR-SEC-10). Persisted counterpart to the
 * stateless session JWT (`application/session-token.ts`) — its `id` is embedded
 * in the JWT as the `sid` claim. Introduced specifically so a session can be
 * *revoked*: a bare JWT can't express "no longer valid" without a DB check, so
 * every session-consuming request now also looks this row up (indexed PK read)
 * and rejects when `revoked_at IS NOT NULL` or `expires_at <= now()` — see
 * `apps/web/src/lib/session.ts`. This is an intentional, disclosed shift from a
 * purely stateless token (README's Phase 4 decision log #5).
 */
export const authSession = pgTable(
  "auth_session",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("auth_session_tenant_user_idx").on(t.tenantId, t.userId)],
);

/**
 * **scim_token** (Phase 4, BL-36, FR-SEC-10). The bearer credential an enterprise
 * IdP presents to `/api/scim/v2/{tenantSlug}/**`. One active token per tenant
 * (rotate replaces, never appends) — argon2id-hashed exactly like a password,
 * never stored/returned in plaintext after issuance. `token_prefix` is a short,
 * non-secret lookup aid (first 8 chars of the raw secret) so verification doesn't
 * need to argon2-compare against every historical row.
 */
export const scimToken = pgTable(
  "scim_token",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("scim_token_tenant_idx").on(t.tenantId)],
);

/**
 * **api_key** (Phase 4, BL-36, FR-SEC-10/FR-API-01). A scoped, hashed bearer
 * credential belonging to a `ServiceAccount`-kind `app_user` — the `nbk_…`
 * tenant API key LLD §5.1 names for `/api/v1/admin/**`. `key_prefix` is unique
 * *within* a tenant (not globally — see README decision #3) so verification is a
 * single tenant-scoped indexed read, never a cross-tenant scan. `scope_matrix`,
 * when set, is intersected with (never allowed to widen) the service account's
 * role-derived permission matrix at call time — see
 * `application/service-account.ts`.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    serviceAccountUserId: uuid("service_account_user_id")
      .notNull()
      .references(() => appUser.id),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopeMatrix: jsonb("scope_matrix").$type<PermissionMatrix | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_key_tenant_prefix_key").on(t.tenantId, t.keyPrefix),
    index("api_key_tenant_service_account_idx").on(t.tenantId, t.serviceAccountUserId),
  ],
);
