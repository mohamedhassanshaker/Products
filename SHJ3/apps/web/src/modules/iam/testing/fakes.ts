/**
 * In-memory implementations of every `iam` port.
 *
 * These exist because the ports exist, which is the practical payoff ADR-0006
 * claims for the indirection layer: the sign-in flow, the session lifecycle, the
 * lockout schedule and the TOTP window are all exercised with no Redis, no SQL
 * Server and no Argon2 — so the whole authentication suite runs inside a
 * pre-commit hook.
 *
 * Two rules these fakes hold to, because a fake that is more permissive than the
 * real adapter tests nothing:
 *
 *  - **Ids are generated, never accepted.** `create` mints its own, matching
 *    `SessionStore`'s contract. Deterministic (`session-1`, `session-2`) so
 *    assertions can name them, which the real store cannot be and must not be.
 *  - **Failures are reachable.** Every fake can be driven to the unhappy path,
 *    because that is where the authorization decisions live.
 *
 * Not a `.test.ts` file: it is the module's test support, imported by tests, and
 * subject to the same lint rules as production code.
 */

import type { Clock, TenantRegistry } from "../../platform/ports/provisioning.js";
import type { Tenant, TenantStatus } from "../../platform/domain/tenant.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { AssuranceLevel } from "../domain/assurance.js";
import { NO_FAILURES, type LockoutState } from "../domain/lockout.js";
import { PERMISSION_CATALOG, ROLE_KEYS, type Permission } from "../domain/permissions.js";
import { SECURITY_POLICY_DEFAULTS } from "../domain/security-policy.js";
import type {
  SecurityPolicyRepository,
  SecurityPolicyRow,
  UpdateSecurityPolicyInput,
} from "../ports/security-policy-repository.js";
import { remainingTtlSeconds, ttlPolicyFor, type SessionRecord } from "../domain/session.js";
import type {
  CredentialRepository,
  PasswordRotation,
  StaffCredential,
} from "../ports/credential-repository.js";
import {
  CHALLENGE_FAILURES_BEFORE_BURN,
  type ChallengeStore,
  type NewSession,
  type ReplayGuard,
  type SessionStore,
  type TotpChallenge,
} from "../ports/session-store.js";
import type {
  AuditContext,
  AuditedStatusChange,
  NewStaffUser,
  ProfileEdit,
  StaffUser,
  StaffUserStatus,
  UserRepository,
} from "../ports/user-repository.js";
import type { NewTeam, Team, TeamMembership, TeamRepository } from "../ports/team-repository.js";
import type {
  NewCustomRole,
  PermissionCatalogEntry,
  Role,
  RolePermissionChange,
  RoleRepository,
  UpdatePermissionsResult,
} from "../ports/role-repository.js";
import type {
  EnrolmentTokenIssuer,
  PasswordHasher,
} from "../adapters/outbound/local-password-provider.js";

/** A clock a test moves by hand. Nothing in `iam` reads the wall clock directly. */
export class FakeClock implements Clock {
  constructor(private current: Date = new Date("2026-09-08T09:00:00.000Z")) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }

  set(at: Date): void {
    this.current = new Date(at);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();
  private counter = 0;

  /** The TTL last written per session, so a test can assert the idle/absolute clamp. */
  readonly ttlWrites = new Map<string, number>();

  async create(input: NewSession, now: Date): Promise<SessionRecord> {
    this.counter += 1;
    const session: SessionRecord = {
      id: `session-${this.counter}`,
      kind: input.kind,
      stage: input.stage,
      subjectId: input.subjectId,
      tenant: input.tenant,
      displayName: input.displayName,
      assurance: input.assurance,
      epoch: input.epoch,
      binding: input.binding,
      issuedAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + input.ttl.absoluteSeconds * 1_000),
    };
    this.records.set(session.id, session);
    this.ttlWrites.set(session.id, remainingTtlSeconds(session, input.ttl, now));
    return session;
  }

  async read(sessionId: string): Promise<SessionRecord | null> {
    return this.records.get(sessionId) ?? null;
  }

  async touch(
    session: SessionRecord,
    now: Date,
    ttlOverride?: ReturnType<typeof ttlPolicyFor>,
  ): Promise<void> {
    const ttl = remainingTtlSeconds(session, ttlOverride ?? ttlPolicyFor(session.kind, session.stage), now);
    if (ttl <= 0) {
      this.records.delete(session.id);
      return;
    }
    this.records.set(session.id, session);
    this.ttlWrites.set(session.id, ttl);
  }

  async destroy(sessionId: string): Promise<void> {
    this.records.delete(sessionId);
    this.ttlWrites.delete(sessionId);
  }

  async destroyAllForSubject(subjectId: string): Promise<number> {
    let destroyed = 0;
    for (const [id, record] of [...this.records]) {
      if (record.subjectId !== subjectId) continue;
      this.records.delete(id);
      this.ttlWrites.delete(id);
      destroyed += 1;
    }
    return destroyed;
  }

  /**
   * Which tenant `destroyAllForTenant()` operates on. The real store reads this from
   * `getTenantCache()`'s ambient binding (no parameter, `session-store.ts`'s own doc
   * comment); this fake has no `runWithTenant()` context of its own, so a test sets this
   * directly to mean "ambiently bound to this tenant right now."
   */
  ambientTenant: TenantSlug | null = null;

  async destroyAllForTenant(): Promise<number> {
    let destroyed = 0;
    for (const [id, record] of [...this.records]) {
      if (record.tenant !== this.ambientTenant) continue;
      this.records.delete(id);
      this.ttlWrites.delete(id);
      destroyed += 1;
    }
    return destroyed;
  }

  /** Test inspection. Not part of the port. */
  size(): number {
    return this.records.size;
  }

  /** Replace a stored record, to simulate a session that has aged in place. */
  put(session: SessionRecord): void {
    this.records.set(session.id, session);
  }
}

export class InMemoryChallengeStore implements ChallengeStore {
  private readonly challenges = new Map<string, TotpChallenge>();
  private counter = 0;

  async issue(
    challenge: Omit<TotpChallenge, "id" | "failureCount">,
    now: Date,
  ): Promise<TotpChallenge> {
    void now;
    this.counter += 1;
    const issued: TotpChallenge = {
      ...challenge,
      id: `challenge-${this.counter}`,
      failureCount: 0,
    };
    this.challenges.set(issued.id, issued);
    return issued;
  }

  async read(challengeId: string): Promise<TotpChallenge | null> {
    return this.challenges.get(challengeId) ?? null;
  }

  async recordFailure(challengeId: string): Promise<TotpChallenge | null> {
    const existing = this.challenges.get(challengeId);
    if (!existing) return null;

    const updated: TotpChallenge = { ...existing, failureCount: existing.failureCount + 1 };
    if (updated.failureCount >= CHALLENGE_FAILURES_BEFORE_BURN) {
      this.challenges.delete(challengeId);
      return null;
    }
    this.challenges.set(challengeId, updated);
    return updated;
  }

  async burn(challengeId: string): Promise<void> {
    this.challenges.delete(challengeId);
  }
}

/**
 * Test-and-set over a `Set`. Single-threaded, so the atomicity the real guard buys
 * with `SET NX` is free here — the behaviour under test is "a second presentation
 * of the same code is refused", which this reproduces exactly.
 */
export class InMemoryReplayGuard implements ReplayGuard {
  private readonly seen = new Set<string>();

  async remember(subject: string, code: string, ttlSeconds: number): Promise<boolean> {
    void ttlSeconds;
    const key = `${subject}:${code}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

export interface FakeUserSeed {
  readonly user: StaffUser;
  readonly roles: readonly string[];
}

export class FakeUserRepository implements UserRepository {
  private readonly users = new Map<string, StaffUser>();
  private readonly roles = new Map<string, readonly string[]>();
  private readonly memberships = new Map<string, readonly TenantSlug[]>();
  private counter = 0;

  /** Every audited status change, in order. Asserted by the suspension tests. */
  readonly statusChanges: AuditedStatusChange[] = [];
  readonly logins: { staffUserId: string; at: Date }[] = [];
  /** Every profile/role/removal audit, in order — B-2's own tests assert against these. */
  readonly profileEdits: { staffUserId: string; edit: ProfileEdit; audit: AuditContext }[] = [];
  readonly roleAssignmentChanges: {
    staffUserId: string;
    tenant: TenantSlug;
    roleKeys: readonly string[];
    audit: AuditContext;
  }[] = [];
  readonly revocations: { staffUserId: string; tenant: TenantSlug; audit: AuditContext }[] = [];

  constructor(private matrix: Readonly<Record<string, readonly Permission[]>>) {}

  seed(seed: FakeUserSeed, memberships?: readonly TenantSlug[]): void {
    this.users.set(seed.user.id, seed.user);
    this.roles.set(roleKey(seed.user.id, seed.user.homeTenant), seed.roles);
    this.memberships.set(seed.user.id, memberships ?? [seed.user.homeTenant]);
  }

  setRoles(staffUserId: string, tenant: TenantSlug, roles: readonly string[]): void {
    this.roles.set(roleKey(staffUserId, tenant), roles);
  }

  setMatrix(matrix: Readonly<Record<string, readonly Permission[]>>): void {
    this.matrix = matrix;
  }

  setStatus(staffUserId: string, status: StaffUserStatus): void {
    const user = this.users.get(staffUserId);
    if (user) this.users.set(staffUserId, { ...user, status });
  }

  async findByEmail(email: string): Promise<StaffUser | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async findById(staffUserId: string): Promise<StaffUser | null> {
    return this.users.get(staffUserId) ?? null;
  }

  async rolesFor(staffUserId: string, tenant: TenantSlug): Promise<readonly string[]> {
    return this.roles.get(roleKey(staffUserId, tenant)) ?? [];
  }

  async permissionMatrix(
    tenant: TenantSlug,
  ): Promise<Readonly<Record<string, readonly Permission[]>>> {
    void tenant;
    return this.matrix;
  }

  async membershipsFor(staffUserId: string): Promise<readonly TenantSlug[]> {
    return this.memberships.get(staffUserId) ?? [];
  }

  async changeStatus(change: AuditedStatusChange): Promise<void> {
    const user = this.users.get(change.staffUserId);
    if (!user) throw new Error(`No such user: ${change.staffUserId}`);
    this.users.set(change.staffUserId, { ...user, status: change.status });
    this.statusChanges.push(change);
  }

  async bumpSessionEpoch(staffUserId: string): Promise<number> {
    const user = this.users.get(staffUserId);
    if (!user) throw new Error(`No such user: ${staffUserId}`);
    const sessionEpoch = user.sessionEpoch + 1;
    this.users.set(staffUserId, { ...user, sessionEpoch });
    return sessionEpoch;
  }

  async recordSuccessfulLogin(staffUserId: string, at: Date): Promise<void> {
    this.logins.push({ staffUserId, at });
  }

  async listForTenant(tenant: TenantSlug): Promise<readonly StaffUser[]> {
    return [...this.users.values()]
      .filter((user) => (this.memberships.get(user.id) ?? []).includes(tenant))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async create(input: NewStaffUser, tenant: TenantSlug): Promise<StaffUser> {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      const memberships = this.memberships.get(existing.id) ?? [];
      if (!memberships.includes(tenant)) {
        this.memberships.set(existing.id, [...memberships, tenant]);
      }
      return existing;
    }

    this.counter += 1;
    const user: StaffUser = {
      id: `usr_fake_${this.counter}`,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      status: "Invited",
      homeTenant: tenant,
      sessionEpoch: 0,
    };
    this.users.set(user.id, user);
    this.memberships.set(user.id, [tenant]);
    return user;
  }

  async updateProfile(
    staffUserId: string,
    edit: ProfileEdit,
    audit: AuditContext,
  ): Promise<StaffUser> {
    const user = this.users.get(staffUserId);
    if (!user) throw new Error(`No such user: ${staffUserId}`);
    if (edit.email !== undefined) {
      const conflict = await this.findByEmail(edit.email);
      if (conflict && conflict.id !== staffUserId) {
        throw new Error(`Email "${edit.email}" is already in use by another staff account.`);
      }
    }
    const updated: StaffUser = {
      ...user,
      ...(edit.displayName !== undefined ? { displayName: edit.displayName } : {}),
      ...(edit.email !== undefined ? { email: edit.email.trim().toLowerCase() } : {}),
    };
    this.users.set(staffUserId, updated);
    this.profileEdits.push({ staffUserId, edit, audit });
    return updated;
  }

  async setRoleAssignments(
    staffUserId: string,
    tenant: TenantSlug,
    roleKeys: readonly string[],
    audit: AuditContext,
  ): Promise<void> {
    this.roles.set(roleKey(staffUserId, tenant), roleKeys);
    this.roleAssignmentChanges.push({ staffUserId, tenant, roleKeys, audit });
  }

  async revokeTenantMembership(
    staffUserId: string,
    tenant: TenantSlug,
    audit: AuditContext,
  ): Promise<void> {
    const memberships = this.memberships.get(staffUserId) ?? [];
    if (!memberships.includes(tenant)) {
      throw new Error(
        `Staff user "${staffUserId}" has no active membership in tenant "${tenant}" to revoke.`,
      );
    }
    this.memberships.set(
      staffUserId,
      memberships.filter((m) => m !== tenant),
    );
    this.roles.delete(roleKey(staffUserId, tenant));
    this.revocations.push({ staffUserId, tenant, audit });
  }
}

function roleKey(staffUserId: string, tenant: TenantSlug): string {
  return `${staffUserId}@${tenant}`;
}

export class FakeTeamRepository implements TeamRepository {
  private readonly teams = new Map<string, Team>();
  private readonly memberships = new Map<string, TeamMembership[]>();
  private counter = 0;

  seed(team: Team): void {
    this.teams.set(team.id, team);
  }

  async list(): Promise<readonly Team[]> {
    return [...this.teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(teamId: string): Promise<Team | null> {
    return this.teams.get(teamId) ?? null;
  }

  async create(team: NewTeam): Promise<Team> {
    this.counter += 1;
    const created: Team = {
      id: `team_fake_${this.counter}`,
      name: team.name,
      scope: team.scope,
      description: team.description ?? null,
      isSystem: false,
    };
    this.teams.set(created.id, created);
    return created;
  }

  async listMemberships(): Promise<readonly TeamMembership[]> {
    return [...this.memberships.values()].flat();
  }

  async setMemberships(
    staffUserId: string,
    teamIds: readonly string[],
    actorId: string,
  ): Promise<readonly TeamMembership[]> {
    void actorId;
    const uniqueTeamIds = [...new Set(teamIds)];
    const memberships = uniqueTeamIds.map((teamId, index) => ({
      teamId,
      staffUserId,
      isPrimary: index === 0,
    }));
    this.memberships.set(staffUserId, memberships);
    return memberships;
  }
}

export class FakeRoleRepository implements RoleRepository {
  private readonly roles = new Map<string, Role>();
  private readonly grants = new Map<string, Set<string>>();
  private counter = 0;

  seed(role: Role): void {
    this.roles.set(role.key, role);
  }

  grant(roleKeyValue: string, permission: string): void {
    const set = this.grants.get(roleKeyValue) ?? new Set<string>();
    set.add(permission);
    this.grants.set(roleKeyValue, set);
  }

  async list(): Promise<readonly Role[]> {
    return [...this.roles.values()].sort((a, b) => a.ordinal - b.ordinal);
  }

  async listPermissionCatalog(): Promise<readonly PermissionCatalogEntry[]> {
    return PERMISSION_CATALOG;
  }

  async createCustomRole(role: NewCustomRole): Promise<Role> {
    this.counter += 1;
    const created: Role = {
      id: `role_fake_${this.counter}`,
      key: `custom_role_${this.counter}`,
      displayName: role.displayName,
      isSystem: false,
      ordinal: this.roles.size,
      description: role.description ?? null,
    };
    this.roles.set(created.key, created);
    return created;
  }

  async permissionMatrix(): Promise<Readonly<Record<string, readonly Permission[]>>> {
    const matrix: Record<string, readonly Permission[]> = {};
    for (const role of this.roles.values()) {
      matrix[role.key] = [...(this.grants.get(role.key) ?? [])] as readonly Permission[];
    }
    return matrix;
  }

  async updatePermissions(
    changes: readonly RolePermissionChange[],
    actorId: string,
  ): Promise<UpdatePermissionsResult> {
    void actorId;
    for (const change of changes) {
      if (
        !change.granted &&
        change.roleKey === ROLE_KEYS.SuperAdmin &&
        change.permission === "users:manage"
      ) {
        return {
          ok: false,
          reason: "protected",
          roleKey: change.roleKey,
          permission: change.permission,
          message: "The super_admin grant for users:manage cannot be revoked (B9 tab 3).",
        };
      }
    }
    for (const change of changes) {
      const set = this.grants.get(change.roleKey) ?? new Set<string>();
      if (change.granted) set.add(change.permission);
      else set.delete(change.permission);
      this.grants.set(change.roleKey, set);
    }
    return { ok: true };
  }
}

export class FakeCredentialRepository implements CredentialRepository {
  private readonly rows = new Map<string, StaffCredential>();
  readonly rotations: PasswordRotation[] = [];

  seed(credential: StaffCredential): void {
    this.rows.set(credential.staffUserId, credential);
  }

  async find(staffUserId: string): Promise<StaffCredential | null> {
    return this.rows.get(staffUserId) ?? null;
  }

  async recordLockout(staffUserId: string, state: LockoutState): Promise<void> {
    const existing = this.rows.get(staffUserId);
    if (existing) this.rows.set(staffUserId, { ...existing, lockout: state });
  }

  async replacePassword(rotation: PasswordRotation): Promise<void> {
    this.rotations.push(rotation);
    const existing = this.rows.get(rotation.staffUserId);
    if (existing) {
      this.rows.set(rotation.staffUserId, {
        ...existing,
        passwordHash: rotation.passwordHash,
        passwordAlgorithm: rotation.passwordAlgorithm,
        passwordUpdatedAt: rotation.at,
        mustChangePassword: rotation.mustChangePassword,
      });
    }
  }

  async enrolTotp(staffUserId: string, secretBase32: string, at: Date): Promise<void> {
    const existing = this.rows.get(staffUserId);
    if (existing) {
      this.rows.set(staffUserId, {
        ...existing,
        totpSecret: secretBase32,
        totpEnrolledAt: at,
      });
    }
  }

  async listEnrolmentStatus(staffUserIds: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    const result = new Map<string, boolean>();
    for (const id of staffUserIds) {
      const row = this.rows.get(id);
      if (row) result.set(id, row.totpSecret !== null);
    }
    return result;
  }

  async clearTotp(staffUserId: string, at: Date): Promise<void> {
    void at;
    const existing = this.rows.get(staffUserId);
    if (existing) {
      this.rows.set(staffUserId, { ...existing, totpSecret: null, totpEnrolledAt: null });
    }
  }
}

/**
 * A hasher that prefixes rather than hashes.
 *
 * Argon2id at 19 MiB and two passes is tens of milliseconds per call by design,
 * and the sign-in suite makes hundreds of calls. The real hasher is covered by
 * its own round-trip test at minimal parameters; everything else uses this, so the
 * suite stays fast enough to run on every commit.
 */
export class FakePasswordHasher implements PasswordHasher {
  readonly algorithm = "argon2id";

  constructor(private readonly stale = false) {}

  async hash(plain: string): Promise<string> {
    return `fake:${plain}`;
  }

  async verify(encoded: string, plain: string): Promise<boolean> {
    return encoded === `fake:${plain}`;
  }

  needsRehash(encoded: string): boolean {
    void encoded;
    return this.stale;
  }
}

export class FakeEnrolmentTokenIssuer implements EnrolmentTokenIssuer {
  private readonly tokens = new Map<string, string>();
  private counter = 0;

  async issue(staffUserId: string): Promise<string> {
    this.counter += 1;
    const token = `enrol-${this.counter}`;
    this.tokens.set(token, staffUserId);
    return token;
  }

  async consume(token: string): Promise<string | null> {
    const staffUserId = this.tokens.get(token);
    if (staffUserId === undefined) return null;
    this.tokens.delete(token);
    return staffUserId;
  }
}

/** Records the backoff schedule instead of waiting for it. */
export class RecordingDelay {
  readonly calls: number[] = [];

  readonly delay = async (milliseconds: number): Promise<void> => {
    this.calls.push(milliseconds);
  };
}

export function staffUserFixture(overrides: Partial<StaffUser> = {}): StaffUser {
  return {
    id: "usr_01JBSARA",
    email: "sara.almazrouei@shj.ae",
    displayName: "Sara Al Mazrouei",
    status: "Active",
    homeTenant: "sewa" as TenantSlug,
    sessionEpoch: 0,
    ...overrides,
  };
}

export function credentialFixture(overrides: Partial<StaffCredential> = {}): StaffCredential {
  return {
    staffUserId: "usr_01JBSARA",
    passwordHash: "fake:correct-horse",
    passwordAlgorithm: "argon2id",
    passwordUpdatedAt: new Date("2026-09-01T00:00:00.000Z"),
    mustChangePassword: false,
    totpSecret: null,
    totpEnrolledAt: null,
    lockout: NO_FAILURES,
    ...overrides,
  };
}

/** A base32 secret for TOTP tests. Length is a multiple of 8, as an authenticator emits. */
export const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

export const ANONYMOUS: AssuranceLevel = "L0";

export class FakeSecurityPolicyRepository implements SecurityPolicyRepository {
  private config: SecurityPolicyRow | null = null;

  async ensureTenantConfig(now: Date): Promise<SecurityPolicyRow> {
    this.config ??= { ...SECURITY_POLICY_DEFAULTS, updatedByStaffUserId: null, updatedAt: now };
    return this.config;
  }

  async updateTenantConfig(input: UpdateSecurityPolicyInput): Promise<SecurityPolicyRow> {
    await this.ensureTenantConfig(input.now);
    this.config = {
      staffSessionIdleMinutes: input.staffSessionIdleMinutes,
      staffSessionAbsoluteHours: input.staffSessionAbsoluteHours,
      lockoutFailuresBeforeLock: input.lockoutFailuresBeforeLock,
      lockoutDurationMinutes: input.lockoutDurationMinutes,
      backoffCeilingSeconds: input.backoffCeilingSeconds,
      updatedByStaffUserId: input.updatedByStaffUserId,
      updatedAt: input.now,
    };
    return this.config;
  }
}

/**
 * A `TenantRegistry` stub for `LocalPasswordProvider`/`ResolveSession` tests, which need
 * only `findBySlug`'s `status` — every queried slug is `Active` unless a test calls
 * `setStatus` first, so this is a no-op for every pre-existing sign-in/session test that
 * knows nothing about tenant suspension.
 */
export class FakeTenantRegistry implements TenantRegistry {
  private readonly statuses = new Map<string, TenantStatus>();

  /** Test setup helper — distinct from the port's own `setStatus(slug, status, at)` below. */
  seedStatus(slug: string, status: TenantStatus): void {
    this.statuses.set(slug, status);
  }

  async findBySlug(slug: TenantSlug): Promise<Tenant | null> {
    return {
      slug,
      displayName: slug,
      status: this.statuses.get(slug) ?? "Active",
      sqlSchema: slug,
      neo4jTenantLabel: `Tenant_${slug}`,
      qdrantCollection: `${slug}_knowledge`,
      redisPrefix: `${slug}:`,
      embeddingModel: "fake-embedding-model",
      embeddingDimensions: 8,
      steps: [],
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
  }

  async listActive(): Promise<readonly Tenant[]> {
    return [];
  }

  async listAll(): Promise<readonly Tenant[]> {
    return [];
  }

  async register(): Promise<Tenant> {
    throw new Error("FakeTenantRegistry.register() is not used by iam tests.");
  }

  async recordStep(): Promise<void> {
    throw new Error("FakeTenantRegistry.recordStep() is not used by iam tests.");
  }

  async setStatus(slug: string, status: TenantStatus): Promise<void> {
    this.statuses.set(slug, status);
  }
}
