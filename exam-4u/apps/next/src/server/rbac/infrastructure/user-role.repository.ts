import type { DataSource } from 'typeorm';

/**
 * Raw-SQL access to the tenant-schema `user_role` join table — ported verbatim (logic unchanged)
 * from `legacy/api/src/modules/rbac/infrastructure/repositories/user-role.repository.ts`. Modeled as
 * raw SQL (not a TypeORM entity/relation) deliberately: `user_role` has no columns beyond its
 * composite `(user_id, role_id)` key, and this avoids a bidirectional `UserEntity` (owned by `auth`)
 * ↔ `RoleEntity` (owned by `rbac`) relation neither module actually needs.
 */
export class UserRoleRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The permission-resolution query (HLD/LLD "one indexed two-join query") — a **union** across
   * every role the user holds, deduplicated via `SELECT DISTINCT`. Returns `[]` for a user with zero
   * roles, or a nonexistent user id — never throws, never defaults to "allow". */
  async findEffectivePermissionNames(userId: string): Promise<string[]> {
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT p.name AS name
       FROM user_role ur
       JOIN role_permission rp ON rp.role_id = ur.role_id
       JOIN permission p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`,
      [userId],
    );
    return rows.map((r) => r.name);
  }

  async findRoleIdsForUser(userId: string): Promise<number[]> {
    const rows: { role_id: number }[] = await this.dataSource.query('SELECT role_id FROM user_role WHERE user_id = ?', [userId]);
    return rows.map((r) => r.role_id);
  }

  async findUserIdsForRole(roleId: number): Promise<string[]> {
    const rows: { user_id: string }[] = await this.dataSource.query('SELECT user_id FROM user_role WHERE role_id = ?', [roleId]);
    return rows.map((r) => r.user_id);
  }

  async isRoleReferenced(roleId: number): Promise<boolean> {
    const rows: { count: number }[] = await this.dataSource.query('SELECT COUNT(*) AS count FROM user_role WHERE role_id = ?', [roleId]);
    return Number(rows[0]?.count ?? 0) > 0;
  }

  /**
   * Atomic full replace of `userId`'s role grants — one transaction (`DELETE` then `INSERT IGNORE`
   * per remaining id), so a partial write can never leave the user with neither the old nor new role
   * set. An empty `roleIds` results in only the `DELETE` (no inserts) — the user ends up with zero
   * roles.
   */
  async replaceRolesForUser(userId: string, roleIds: number[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM user_role WHERE user_id = ?', [userId]);
      for (const roleId of roleIds) {
        await manager.query('INSERT IGNORE INTO user_role (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
      }
    });
  }
}
