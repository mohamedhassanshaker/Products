import type { DataSource, Repository } from 'typeorm';
import { UserEntity } from '@/server/infrastructure/database';

/**
 * The sole place that ever queries the tenant-schema `user` table — ported verbatim (logic
 * unchanged) from `legacy/api/src/modules/auth/infrastructure/repositories/user.repository.ts`,
 * adapted from a NestJS `@Injectable()` provider (resolving its `Repository<UserEntity>` fresh per
 * call from `TenantContextService.entityManager()`) to a plain class constructed with an
 * already-resolved tenant `DataSource` (this app's `requireTenantDataSource()`, read once per Route
 * Handler invocation by whichever composition function builds this repository — never cached across
 * requests, since the underlying tenant `DataSource` differs per tenant).
 *
 * `user_role`/`role` access (`findRoleIdByName`/`assignRole`) is raw SQL, matching legacy's own
 * convention of avoiding a bidirectional `UserEntity` ↔ `RoleEntity` relation across the `auth`/`rbac`
 * module boundary.
 */
export class UserRepository {
  private readonly repo: Repository<UserEntity>;

  constructor(private readonly dataSource: DataSource) {
    // Looked up by the literal table-name string ('user'), not the `UserEntity` class reference — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the full explanation: Next.js can bundle
    // this same source file into more than one webpack chunk/route entry, producing distinct class
    // objects whose *minified* `.name` no longer matches across bundles, which breaks TypeORM's
    // fallback class-identity metadata lookup in production. A literal string is immune to that.
    this.repo = dataSource.getRepository<UserEntity>('user');
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { email } });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async insert(data: Partial<UserEntity>): Promise<UserEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async updateLastLogin(id: string, when: Date): Promise<void> {
    await this.repo.update({ id }, { lastLoginAt: when });
  }

  async setResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.repo.update({ id }, { passwordResetTokenHash: tokenHash, passwordResetTokenExpiry: expiresAt });
  }

  async findByResetTokenHash(tokenHash: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { passwordResetTokenHash: tokenHash } });
  }

  /** Sets a new password hash and atomically clears any reset-token fields — this is what makes a
   * reset token single-use: a replayed token's hash no longer matches any row. */
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repo.update({ id }, { passwordHash, passwordResetTokenHash: null, passwordResetTokenExpiry: null });
  }

  /** Raw SQL — `role` belongs to the `rbac` module's own tenant-schema tables, but `auth` needs a
   * by-name lookup for `assignDefaultRoleIfConfigured`'s self-registration default-role grant. */
  async findRoleIdByName(name: string): Promise<number | null> {
    const rows: { id: number }[] = await this.dataSource.query('SELECT id FROM role WHERE name = ? LIMIT 1', [name]);
    return rows[0]?.id ?? null;
  }

  /** Natural-key upsert (`user_id`, `role_id` composite PK) — safe to call even if the grant already
   * exists. */
  async assignRole(userId: string, roleId: number): Promise<void> {
    await this.dataSource.query('INSERT IGNORE INTO user_role (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
  }

  /** Hygiene job (not required for `resetPassword`'s own correctness — its own expiry check already
   * rejects an expired-but-not-yet-pruned token) — clears stale reset-token fields for rows whose
   * expiry has passed. Called by `TenantHygieneService.pruneExpiredResetTokens` (Phase 2 sub-slice
   * "2d"'s `TenantMaintenanceWorker`). Returns the number of rows cleared, matching legacy's identical
   * `mysql2`-driver `affectedRows` convention, for the worker's own logging/test assertions. */
  async pruneExpiredResetTokens(): Promise<number> {
    const result: { affectedRows?: number } = await this.dataSource.query(
      'UPDATE `user` SET password_reset_token_hash = NULL, password_reset_token_expiry = NULL ' +
        'WHERE password_reset_token_expiry IS NOT NULL AND password_reset_token_expiry < NOW(3)',
    );
    return result?.affectedRows ?? 0;
  }
}
