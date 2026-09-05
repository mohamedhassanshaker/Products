import type { DataSource, Repository } from 'typeorm';
import { In } from 'typeorm';
import { UserEntity } from '@/server/infrastructure/database';
// Cross-module barrel import (reliability's own public API, not an internal deep import) — see
// `server/profile/infrastructure/profile.repository.ts`'s identical doc comment for why this is
// allowed under this app's module-boundary rule.
import { OutboxRepository } from '@/server/reliability';
import type { ListUsersOptions, UserSortColumn } from '../domain/user.types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_BY: UserSortColumn = 'createdAt';
const DEFAULT_SORT_DIR = 'desc';

/**
 * Admin-facing data access over the tenant-scoped `user` table — ported logic from
 * `legacy/api/src/modules/users/infrastructure/repositories/user-admin.repository.ts`'s
 * `UserAdminRepository`, adapted to this app's DataSource-constructor convention. Deliberately a
 * **separate** repository class from `server/auth`'s `UserRepository`, even though both map the
 * identical `UserEntity` — each module owns only the queries *it* needs.
 */
export class UserAdminRepository {
  private readonly repo: Repository<UserEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository<UserEntity>('user');
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Case-insensitive-per-collation lookup (mirrors `auth`'s `UserRepository.findByEmail`) — used
   * for `UsersService.create()`'s `EMAIL_ALREADY_REGISTERED` pre-check. */
  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { email } });
  }

  /** Every user whose id is in `ids`, keyed by id — a future bulk-hydration read path's tool; ids
   * absent from the returned map are the "no longer exists" (deleted user) case. */
  async findByIds(ids: string[]): Promise<UserEntity[]> {
    if (ids.length === 0) return [];
    return this.repo.find({ where: { id: In(Array.from(new Set(ids))) } });
  }

  /**
   * Persists a brand-new admin-created user row **and**, atomically in the same transaction,
   * enqueues a `user.created` outbox event (FR-REL-1) — this dispatch's own real, deliberately
   * chosen producer proving the `reliability` module's transactional-outbox mechanism end to end
   * against a genuine business event (legacy's `UsersService.create` has no such event; this is new
   * scope, not a port). Mirrors `ProfileRepository.setPicture`'s identical "repository-level
   * cross-module transactional write" precedent, rather than growing `UsersService`'s own
   * constructor to six-plus collaborators to thread a transaction through it.
   *
   * Callers (`UsersService.create`) are responsible for having already validated password strength
   * and per-tenant email uniqueness.
   */
  async insert(data: Partial<UserEntity>): Promise<UserEntity> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository<UserEntity>('user');
      const entity = repo.create(data);
      const saved = await repo.save(entity);
      await new OutboxRepository(this.dataSource).enqueue(tx, 'user.created', { userId: saved.id, email: saved.email });
      return saved;
    });
  }

  /** Persists identity/profile field changes (`UsersService.update`). Never touches
   * `passwordHash`/reset-token columns — those are `auth`'s exclusive write path. */
  async update(id: string, data: Partial<UserEntity>): Promise<void> {
    await this.repo.update({ id }, data);
  }

  /** Hard-deletes the user row (FR-IAM-7). `user_role` rows referencing this id cascade-delete
   * automatically (`fk_ur_user ... ON DELETE CASCADE`). */
  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  /** Paginated, searchable, sortable listing (FR-IAM-7). `search` matches against email OR
   * firstName OR lastName via a plain SQL `LIKE` — case-insensitively "for free" since the `user`
   * table's default collation is `utf8mb4_0900_ai_ci`. */
  async findMany(options: ListUsersOptions): Promise<{ items: UserEntity[]; total: number }> {
    const page = options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const pageSize =
      options.pageSize && options.pageSize > 0 ? Math.min(Math.floor(options.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const sortBy = options.sortBy ?? DEFAULT_SORT_BY;
    const sortDir = (options.sortDir ?? DEFAULT_SORT_DIR).toUpperCase() as 'ASC' | 'DESC';

    const columnMap: Record<UserSortColumn, string> = {
      email: 'user.email',
      firstName: 'user.first_name',
      lastName: 'user.last_name',
      createdAt: 'user.created_at',
      lastLoginAt: 'user.last_login_at',
    };

    const qb = this.repo.createQueryBuilder('user');
    const search = options.search?.trim();
    if (search) {
      qb.andWhere('(user.email LIKE :search OR user.first_name LIKE :search OR user.last_name LIKE :search)', {
        search: `%${search}%`,
      });
    }
    qb.orderBy(columnMap[sortBy], sortDir)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
