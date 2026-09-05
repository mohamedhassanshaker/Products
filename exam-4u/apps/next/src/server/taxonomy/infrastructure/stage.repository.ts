import type { DataSource, Repository } from 'typeorm';
import { StageEntity } from '@/server/infrastructure/database';

/** Data access over the tenant-scoped `stage` table — ported logic from
 * `legacy/api/src/modules/taxonomy/infrastructure/repositories/stage.repository.ts`. See
 * `EducationLevelRepository`'s doc comment for the shared repository conventions this class follows. */
export class StageRepository {
  private readonly repo: Repository<StageEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository<StageEntity>('stage');
  }

  async findByEducationLevel(educationLevelId: number): Promise<StageEntity[]> {
    return this.repo.find({ where: { educationLevelId }, order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<StageEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Case-insensitive lookup, scoped to `educationLevelId` (FR-TAX-1: "the same Stage name may exist
   * under two different Education Levels") — relies on `uq_stage_name`'s `utf8mb4_0900_ai_ci`
   * collation for the case-insensitive part. */
  async findByName(educationLevelId: number, name: string): Promise<StageEntity | null> {
    return this.repo.findOne({ where: { educationLevelId, name } });
  }

  /** @throws a raw TypeORM `QueryFailedError` on a duplicate `(education_level_id, name)` pair. */
  async create(educationLevelId: number, name: string): Promise<StageEntity> {
    const entity = this.repo.create({ educationLevelId, name });
    return this.repo.save(entity);
  }

  /** @throws a raw TypeORM `QueryFailedError` if `id` is still referenced by a `subject` row (or any
   * future referencing table). */
  async delete(id: number): Promise<void> {
    await this.repo.delete({ id });
  }
}
