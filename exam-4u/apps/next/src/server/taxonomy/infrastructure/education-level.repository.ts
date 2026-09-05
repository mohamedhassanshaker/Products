import type { DataSource, Repository } from 'typeorm';
import { EducationLevelEntity } from '@/server/infrastructure/database';

/**
 * Data access over the tenant-scoped `education_level` table — ported logic from
 * `legacy/api/src/modules/taxonomy/infrastructure/repositories/education-level.repository.ts`, adapted
 * to this app's `DataSource`-constructor convention (no NestJS DI). Uses the literal table-name string
 * form (`getRepository<T>('table_name')`), never the entity class, per this app's established
 * cross-webpack-bundle TypeORM fix (Phase 1 sub-slice 1b's "Decisions made" #3).
 */
export class EducationLevelRepository {
  private readonly repo: Repository<EducationLevelEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository<EducationLevelEntity>('education_level');
  }

  async findAll(): Promise<EducationLevelEntity[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<EducationLevelEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Case-insensitive lookup by name — relies entirely on the table's `utf8mb4_0900_ai_ci` collation
   * (see the migration's own doc comment), so `WHERE name = ?` already matches case-insensitively at
   * the database layer without any `LOWER()` normalization here. */
  async findByName(name: string): Promise<EducationLevelEntity | null> {
    return this.repo.findOne({ where: { name } });
  }

  /** @throws a raw TypeORM `QueryFailedError` (never wrapped) on a duplicate name —
   * `TaxonomyService.createOrFetchEducationLevel` uses `mysql-error.util`'s `isDuplicateKeyError` to
   * translate it into the create-or-fetch fallback lookup. */
  async create(name: string): Promise<EducationLevelEntity> {
    const entity = this.repo.create({ name });
    return this.repo.save(entity);
  }

  /** Raw parameterized count against `user` (owned by `server/auth`, not this module) — the same
   * "no owning entity/cross-module raw-SQL" convention this codebase already establishes for pure
   * join-table access. Needed because `user.education_level_id`'s FK uses `ON DELETE SET NULL`, which
   * would otherwise let a referenced `education_level` row be deleted silently — see
   * `TaxonomyService.deleteEducationLevel`'s doc comment. */
  async isReferencedByUser(id: number): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query('SELECT 1 FROM `user` WHERE education_level_id = ? LIMIT 1', [id]);
    return rows.length > 0;
  }

  /** @throws a raw TypeORM `QueryFailedError` if `id` is still referenced by a `stage` row (or any
   * future referencing table) — `TaxonomyService.deleteEducationLevel` uses `mysql-error.util`'s
   * `isRowReferencedError` to translate it into `TaxonomyEntryInUseError`. */
  async delete(id: number): Promise<void> {
    await this.repo.delete({ id });
  }
}
