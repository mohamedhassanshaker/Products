/**
 * Roles and permissions.
 *
 * Implements B9 tab 3's 7 x 8 matrix, which is the screen that determines what
 * every other screen permits.
 *
 * ## Deny by default
 *
 * The matrix below is the *seeded* configuration, not the enforcement. A
 * permission absent from a role's set is denied — there is no fallback, no
 * wildcard and no implicit grant from one permission to another. That matters
 * because the matrix is editable at runtime (every cell in B9 tab 3 is a
 * toggle) and custom roles start with everything off, so enforcement has to be
 * a set membership test rather than a chain of special cases.
 *
 * ## Separation of duties
 *
 * The one rule worth reading the matrix for: **Agent Designer can build but not
 * publish.** Publishing is an Entity Admin action (B9's `[rule]`). Authoring and
 * release are deliberately different people, which is why `agents:manage` and
 * `agents:publish` are separate permissions rather than one.
 *
 * This module holds no vendor imports (architecture.md §4) — authorization is
 * pure logic, and keeping it that way is what makes the whole matrix testable
 * without a database.
 */

/**
 * The nine permissions from B9 tab 3.
 *
 * Named `resource:action` so a route handler's requirement reads as a sentence
 * and so new resources extend the vocabulary rather than overloading it.
 *
 * `appearance:manage` was added post-launch (theming backend wave, 2026-09-09,
 * design-system.md §9.3, `FR-THEME-18`): the matrix moved from 8 to 9 permissions
 * to gate who may change TENANT branding (Settings -> Appearance's tenant-wide
 * skin/mode/logo controls). A user's OWN personal preference (mode, density, base
 * font size, direction, reduced motion) needs no permission at all — §9.3's whole
 * point is that a user controls legibility and comfort for themselves regardless
 * of role, and only an admin controls identity for the tenant. Appended at the end
 * rather than interleaved, so no existing permission's position in the matrix shifts.
 *
 * `evaluation:manage` and `governance:manage` were added for B-9 (evaluation,
 * governance & analytics, 2026-09-10): golden sets / regression runs / the publish
 * gate (B13) and environments / promotions / the audit log / observability /
 * privacy & data (B14) are both release-governance surfaces, not authoring ones —
 * the same "build vs. release" separation `agents:publish` already draws — so both
 * are restricted the same way `agents:publish` is (see `RESTRICTED_PERMISSIONS`
 * below) rather than folded into `agents:manage`/`analytics:view`. The command
 * centre (B1) needed no new permission: it is gated by the pre-existing
 * `dashboard:view` (already the admin-landing-screen permission every seeded role
 * but `LiveAgent` holds) alongside `analytics:view` for its metrics/explorer detail.
 * Both appended at the end, positions 10-11, per this same append-only convention.
 *
 * `security:manage` was added for the new Security tab (B9, 2026-09-13): session-timeout
 * and account-lockout policy, plus TOTP administration, both previously hardcoded with no
 * screen at all. Restricted the same way `appearance:manage` is (see
 * `RESTRICTED_PERMISSIONS`) — appended at position 12, per this same convention.
 *
 * `platform:operate` was added for the platform-admin wave (2026-09-13): the new
 * cross-tenant console (tenant lifecycle, cross-tenant branding override) gated by
 * `modules/platform/application/require-platform-operator.ts`'s compound check. Unlike
 * every permission above, it is deliberately **never** added to `SEEDED_ROLE_PERMISSIONS` —
 * not even for `SuperAdmin` — because a permission alone is not the security boundary here
 * (any tenant's own SuperAdmin can toggle any matrix cell for their own tenant at runtime,
 * B9 tab 3). It is granted only to the real Platform tenant's own `SuperAdmin` role, by a
 * one-off ops script, and `requirePlatformOperator` additionally requires the principal's
 * tenant to BE that Platform tenant. See that file's own header for the full reasoning.
 *
 * `orchestration:manage` was added for the Orchestrator/router editing wave (2026-09-15):
 * `/orchestrator` (B4) moved from a read-only diagnostic screen (`analytics:view`) to a
 * real editing surface for the tenant-wide `RouterConfig` singleton (execution mode,
 * agent-combination scope, cost/hop ceilings, merge/conflict policy) plus a live
 * trace-preview simulator. A dedicated permission rather than reusing `agents:manage`
 * (authoring) or `routing:manage` (a different table — escalation routing rules) — this
 * governs tenant-wide, cost-affecting pipeline shape, the same release-governance class of
 * surface `evaluation:manage`/`governance:manage`/`security:manage` already are, so it is
 * restricted the same way. Appended at position 14, per this same convention.
 */
export const PERMISSIONS = [
  "dashboard:view",
  "agents:manage",
  "agents:publish",
  "knowledge:manage",
  "routing:manage",
  "escalations:handle",
  "users:manage",
  "analytics:view",
  "appearance:manage",
  "evaluation:manage",
  "governance:manage",
  "security:manage",
  "platform:operate",
  "orchestration:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * B9 tab 3's row headers — display text and column order, code-defined
 * (`docs/data-model.md` §4.1: "the 9 code-enforced permissions... not admin-editable").
 *
 * `platform.Permissions` (the SQL table) exists only to give
 * `RolePermissions_permissionKey_fkey` something to reference — "a tenant cannot invent a
 * permission, because a permission with no enforcement point is a lie in a matrix" — and
 * is written once by the seed script, never read back by application code. This constant
 * is the catalog B9 tab 3 actually renders from: zero I/O, and it cannot drift from the
 * `PERMISSIONS` array above because `ordinal` is derived from that array's own order
 * rather than hand-numbered a second time. Mirrors `resolve-theme.ts`'s identical
 * reasoning for `@shj3/tokens`' static `systemSkin()` export — small, code-defined,
 * read on every request, not worth a database round trip.
 */
export const PERMISSION_CATALOG: readonly {
  readonly key: Permission;
  readonly displayName: string;
  readonly ordinal: number;
}[] = [
  "View dashboard",
  "Manage agents",
  "Publish agents",
  "Manage knowledge",
  "Manage routing rules",
  "Handle escalations",
  "Manage users & teams",
  "View analytics",
  "Manage appearance",
  "Manage evaluation",
  "Manage governance",
  "Manage security policy",
  "Operate platform console",
  "Manage orchestration",
].map((displayName, ordinal) => ({ key: PERMISSIONS[ordinal]!, displayName, ordinal }));

/** The seven seeded roles from B9 tab 3. Custom roles are added at runtime. */
export const SEEDED_ROLES = [
  "SuperAdmin",
  "EntityAdmin",
  "AgentDesigner",
  "KnowledgeManager",
  "Reviewer",
  "LiveAgent",
  "Analyst",
] as const;

export type SeededRole = (typeof SEEDED_ROLES)[number];

/**
 * The persisted `Roles.key` value for each seeded role — snake_case, not the PascalCase
 * `SeededRole` TS identifier above.
 *
 * Nothing persisted a `Role` row anywhere in this codebase before B-2 (confirmed by
 * grepping every call site), so there was no pre-existing convention to preserve except
 * one: `prisma/sql/001_constraints.sql`'s `TR_RolePermissions_protectSuperAdmin` trigger
 * already hardcodes `r.[key] = 'super_admin'` for the row it protects. This map adopts
 * that convention outright rather than inventing a second one the trigger would then
 * silently fail to recognise — the same class of drift `TR_RolePermissions_
 * protectSuperAdmin`'s *other* literal (`manage_users_teams`, fixed alongside this) was
 * already found to have. Every writer of a `Role` row (the seed script, `create-custom-
 * role.ts`) must derive the key through this map, never invent one inline.
 */
export const ROLE_KEYS: Readonly<Record<SeededRole, string>> = {
  SuperAdmin: "super_admin",
  EntityAdmin: "entity_admin",
  AgentDesigner: "agent_designer",
  KnowledgeManager: "knowledge_manager",
  Reviewer: "reviewer",
  LiveAgent: "live_agent",
  Analyst: "analyst",
};

/**
 * The persisted `Roles.displayName` for each seeded role — B9 tab 1's "Role" column and
 * tab 3's matrix column headers, transcribed from the wireframe (`docs/SHJ3-wireframes-
 * guide.md`'s B9 tab 1 sample rows and tab 3's matrix header row) rather than derived from
 * `SeededRole`'s own PascalCase identifier, which is a TypeScript-ergonomics name, not a
 * user-facing string (`KnowledgeManager` -> "Knowledge Manager", not the wireframe matrix
 * header's abbreviated "Knowledge Mgr" — the *tab 1* row for Priya Nair spells it out in
 * full, "Knowledge Manager", which this uses as the one real display name for the role
 * rather than keeping two different spellings for the same role in two places).
 */
export const SEEDED_ROLE_DISPLAY_NAMES: Readonly<Record<SeededRole, string>> = {
  SuperAdmin: "Super Admin",
  EntityAdmin: "Entity Admin",
  AgentDesigner: "Agent Designer",
  KnowledgeManager: "Knowledge Manager",
  Reviewer: "Reviewer",
  LiveAgent: "Live Agent",
  Analyst: "Analyst",
};

/**
 * B9 tab 3's matrix, transcribed exactly.
 *
 * This is seed data, not policy: it is written to the database at tenant
 * provisioning and every cell is editable afterwards. It lives in code so the
 * seed is deterministic — the E2E suite asserts against these exact grants, and
 * the wireframe's cross-module behaviour only demonstrates correctly from a
 * known starting state.
 *
 * `platform:operate` is deliberately absent from every row, including
 * `SuperAdmin` — see `PERMISSIONS`'s own doc comment above. It is granted only
 * to the real Platform tenant's `SuperAdmin` role, by a one-off ops script, not
 * by this seeded-at-provisioning matrix.
 */
export const SEEDED_ROLE_PERMISSIONS: Readonly<Record<SeededRole, readonly Permission[]>> = {
  SuperAdmin: [
    "dashboard:view",
    "agents:manage",
    "agents:publish",
    "knowledge:manage",
    "routing:manage",
    "escalations:handle",
    "users:manage",
    "analytics:view",
    "appearance:manage",
    "evaluation:manage",
    "governance:manage",
    "security:manage",
    "orchestration:manage",
  ],
  EntityAdmin: [
    "dashboard:view",
    "agents:manage",
    "agents:publish",
    "knowledge:manage",
    "routing:manage",
    "analytics:view",
    "appearance:manage",
    "evaluation:manage",
    "governance:manage",
    "security:manage",
    "orchestration:manage",
  ],
  // Builds but does not publish — the separation of duties in B9's [rule].
  AgentDesigner: ["dashboard:view", "agents:manage"],
  KnowledgeManager: ["dashboard:view", "knowledge:manage"],
  Reviewer: ["dashboard:view", "analytics:view"],
  // Deliberately has no dashboard access in the wireframe's matrix. A live agent
  // works the escalation queue and nothing else.
  LiveAgent: ["escalations:handle"],
  Analyst: ["dashboard:view", "analytics:view"],
};

/**
 * Only Super Admin may manage users and teams (B9 tab 3), and only Super Admin
 * and Entity Admin may publish — or, as of the theming backend wave, manage
 * tenant appearance, which the seeded matrix grants to exactly the same two
 * roles as `agents:publish` (design-system.md §9.3). Asserted as an invariant
 * rather than left implicit, because these are the grants whose accidental
 * widening would matter most.
 */
export const RESTRICTED_PERMISSIONS: Readonly<Record<string, readonly SeededRole[]>> = {
  "users:manage": ["SuperAdmin"],
  "agents:publish": ["SuperAdmin", "EntityAdmin"],
  "appearance:manage": ["SuperAdmin", "EntityAdmin"],
  "evaluation:manage": ["SuperAdmin", "EntityAdmin"],
  "governance:manage": ["SuperAdmin", "EntityAdmin"],
  "security:manage": ["SuperAdmin", "EntityAdmin"],
  "orchestration:manage": ["SuperAdmin", "EntityAdmin"],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The authorization decision.
 *
 * Deny by default: membership in the granted set is the *only* way to be
 * allowed. No wildcard, no role hierarchy, no "admin implies everything" — a
 * hierarchy would mean the matrix in B9 tab 3 is not the whole truth, and an
 * editable matrix that is not the whole truth is worse than no matrix.
 */
export function isAllowed(granted: ReadonlySet<string>, required: Permission): boolean {
  return granted.has(required);
}

/**
 * Resolve a principal's effective permissions from its roles.
 *
 * Union across roles, because a user may hold more than one. Unknown role names
 * contribute nothing rather than throwing: a role deleted from the matrix while
 * a session is live must reduce access, never escalate it or 500 the request.
 */
export function resolvePermissions(
  roles: readonly string[],
  matrix: Readonly<Record<string, readonly Permission[]>>,
): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of matrix[role] ?? []) granted.add(permission);
  }
  return granted;
}

export class PermissionDeniedError extends Error {
  constructor(
    readonly required: Permission,
    readonly operation: string,
  ) {
    // The required permission is named but the principal's granted set is not:
    // telling a caller what they *do* have is an information leak, and telling
    // them what they need is the actionable half.
    super(`"${operation}" requires the ${required} permission.`);
    this.name = "PermissionDeniedError";
  }
}
