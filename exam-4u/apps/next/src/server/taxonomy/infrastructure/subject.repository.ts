import type { DataSource, Repository } from 'typeorm';
import { SubjectEntity } from '@/server/infrastructure/database';

/** Data access over the tenant-scoped `subject` table — ported logic from
 * `legacy/api/src/modules/taxonomy/infrastructure/repositories/subject.repository.ts`. See
 * `EducationLevelRepository`'s doc comment for the shared repository conventions this class follows. */
export class SubjectRepository {
  private readonly repo: Repository<SubjectEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository<SubjectEntity>('subject');
  }

  async findByStage(stageId: number): Promise<SubjectEntity[]> {
    return this.repo.find({ where: { stageId }, order: { name: 'ASC' } });
  }

  /** Every Subject in this tenant, regardless of stage — used by `server/curricula`'s cascading
   * Subject picker/validation and, in a later phase, PDF-processing's subject classification, which
   * picks among the tenant's *entire* taxonomy rather than one stage. */
  async findAll(): Promise<SubjectEntity[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<SubjectEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Case-insensitive lookup, scoped to `stageId` — relies on `uq_subject_name`'s `utf8mb4_0900_ai_ci`
   * collation for the case-insensitive part. */
  async findByName(stageId: number, name: string): Promise<SubjectEntity | null> {
    return this.repo.findOne({ where: { stageId, name } });
  }

  /** @throws a raw TypeORM `QueryFailedError` on a duplicate `(stage_id, name)` pair. */
  async create(stageId: number, name: string): Promise<SubjectEntity> {
    const entity = this.repo.create({ stageId, name });
    return this.repo.save(entity);
  }

  /** @throws a raw TypeORM `QueryFailedError` if `id` is still referenced by any referencing table —
   * as of this phase, `curriculum.subject_id`'s FK (`ON DELETE RESTRICT`). */
  async delete(id: number): Promise<void> {
    await this.repo.delete({ id });
  }
}
