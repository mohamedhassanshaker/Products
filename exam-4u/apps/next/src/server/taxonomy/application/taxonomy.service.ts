import { isDuplicateKeyError, isRowReferencedError } from '../infrastructure/mysql-error.util';
import { InvalidNameError, TaxonomyEntryInUseError, TaxonomyEntryNotFoundError } from '../domain/errors';
import type { EducationLevelRepository } from '../infrastructure/education-level.repository';
import type { StageRepository } from '../infrastructure/stage.repository';
import type { SubjectRepository } from '../infrastructure/subject.repository';
import type { CreateOrFetchResult, EducationLevelSummary, StageSummary, SubjectSummary } from '../domain/taxonomy.types';
import type { EducationLevelEntity, StageEntity, SubjectEntity } from '@/server/infrastructure/database';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 150;

/**
 * FR-TAX-1..4's taxonomy business rules — ported logic (not code) from
 * `legacy/api/src/modules/taxonomy/application/taxonomy.service.ts`'s `TaxonomyService`, adapted to
 * this app's plain-class composition convention (no NestJS DI).
 *
 * **Create-or-fetch concurrency (FR-TAX-2), a deliberate judgment call, ported verbatim**: rather than
 * a check-then-insert, this service attempts the insert first and falls back to a re-fetch only on a
 * genuine duplicate-key violation. A check-then-insert has a real TOCTOU race under concurrent "ensure
 * this exists" calls (FR-TAX-2's own stated use case), which would either double-insert (impossible
 * here, since the unique key rejects it) or throw an unhandled duplicate-key error to one of the two
 * concurrent callers. Insert-first, catch-and-refetch is safe under concurrency by construction:
 * whichever caller's insert wins, the other's catch branch re-fetches the now-committed row.
 *
 * **Deletion protection (FR-TAX-4), a two-part strategy, ported verbatim**:
 * 1. `education_level` specifically: `user.education_level_id`'s FK uses `ON DELETE SET NULL`, which
 *    means the database itself would **not** reject a delete referenced by a user — it would silently
 *    null the reference out. So this service explicitly checks `EducationLevelRepository
 *    .isReferencedByUser` *before* attempting the delete, matching the spec's literal wording
 *    ("referenced by... User via education level").
 * 2. Every level, generically: `stage`/`subject`'s own hierarchy FKs (and `curriculum.subject_id`'s FK,
 *    this same phase) use `ON DELETE RESTRICT` — this service wraps every delete in a generic MySQL-FK-
 *    violation-to-`TaxonomyEntryInUseError` translation (`isRowReferencedError`), which protects
 *    against *any* current or future referencing table without this module needing to know its name.
 */
export class TaxonomyService {
  constructor(
    private readonly educationLevels: EducationLevelRepository,
    private readonly stages: StageRepository,
    private readonly subjects: SubjectRepository,
  ) {}

  async listEducationLevels(): Promise<EducationLevelSummary[]> {
    const rows = await this.educationLevels.findAll();
    return rows.map(toEducationLevelSummary);
  }

  /** FR-TAX-2. @throws {InvalidNameError} if `name` (after trim) is not 2–150 characters. */
  async createOrFetchEducationLevel(name: string): Promise<CreateOrFetchResult<EducationLevelSummary>> {
    const trimmed = validateName(name);
    try {
      const created = await this.educationLevels.create(trimmed);
      return { entity: toEducationLevelSummary(created), created: true };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existing = await this.educationLevels.findByName(trimmed);
        if (existing) {
          return { entity: toEducationLevelSummary(existing), created: false };
        }
      }
      throw error;
    }
  }

  /** @throws {TaxonomyEntryNotFoundError} if no such `education_level` exists.
   * @throws {TaxonomyEntryInUseError} if referenced by a `user` row or (generically) any other
   *   referencing table (FR-TAX-4). */
  async deleteEducationLevel(id: number): Promise<void> {
    await this.requireEducationLevel(id);
    if (await this.educationLevels.isReferencedByUser(id)) {
      throw new TaxonomyEntryInUseError();
    }
    try {
      await this.educationLevels.delete(id);
    } catch (error) {
      if (isRowReferencedError(error)) {
        throw new TaxonomyEntryInUseError();
      }
      throw error;
    }
  }

  /** @throws {TaxonomyEntryNotFoundError} if `educationLevelId` does not exist. */
  async listStages(educationLevelId: number): Promise<StageSummary[]> {
    await this.requireEducationLevel(educationLevelId);
    const rows = await this.stages.findByEducationLevel(educationLevelId);
    return rows.map(toStageSummary);
  }

  /** FR-TAX-2. @throws {TaxonomyEntryNotFoundError} if `educationLevelId` does not exist.
   * @throws {InvalidNameError} if `name` (after trim) is not 2–150 characters. */
  async createOrFetchStage(educationLevelId: number, name: string): Promise<CreateOrFetchResult<StageSummary>> {
    await this.requireEducationLevel(educationLevelId);
    const trimmed = validateName(name);
    try {
      const created = await this.stages.create(educationLevelId, trimmed);
      return { entity: toStageSummary(created), created: true };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existing = await this.stages.findByName(educationLevelId, trimmed);
        if (existing) {
          return { entity: toStageSummary(existing), created: false };
        }
      }
      throw error;
    }
  }

  /** @throws {TaxonomyEntryNotFoundError} if no such `stage` exists.
   * @throws {TaxonomyEntryInUseError} if referenced by a `subject` row or (generically) any other
   *   referencing table (FR-TAX-4). */
  async deleteStage(id: number): Promise<void> {
    await this.requireStage(id);
    try {
      await this.stages.delete(id);
    } catch (error) {
      if (isRowReferencedError(error)) {
        throw new TaxonomyEntryInUseError();
      }
      throw error;
    }
  }

  /** @throws {TaxonomyEntryNotFoundError} if `stageId` does not exist. */
  async listSubjects(stageId: number): Promise<SubjectSummary[]> {
    await this.requireStage(stageId);
    const rows = await this.subjects.findByStage(stageId);
    return rows.map(toSubjectSummary);
  }

  /** FR-TAX-2. @throws {TaxonomyEntryNotFoundError} if `stageId` does not exist.
   * @throws {InvalidNameError} if `name` (after trim) is not 2–150 characters. */
  async createOrFetchSubject(stageId: number, name: string): Promise<CreateOrFetchResult<SubjectSummary>> {
    await this.requireStage(stageId);
    const trimmed = validateName(name);
    try {
      const created = await this.subjects.create(stageId, trimmed);
      return { entity: toSubjectSummary(created), created: true };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existing = await this.subjects.findByName(stageId, trimmed);
        if (existing) {
          return { entity: toSubjectSummary(existing), created: false };
        }
      }
      throw error;
    }
  }

  /** @throws {TaxonomyEntryNotFoundError} if no such `subject` exists.
   * @throws {TaxonomyEntryInUseError} if referenced by any referencing table (FR-TAX-4) — as of this
   *   phase, `curriculum.subject_id`'s FK. */
  async deleteSubject(id: number): Promise<void> {
    await this.requireSubject(id);
    try {
      await this.subjects.delete(id);
    } catch (error) {
      if (isRowReferencedError(error)) {
        throw new TaxonomyEntryInUseError();
      }
      throw error;
    }
  }

  private async requireEducationLevel(id: number): Promise<EducationLevelEntity> {
    const row = await this.educationLevels.findById(id);
    if (!row) throw new TaxonomyEntryNotFoundError();
    return row;
  }

  private async requireStage(id: number): Promise<StageEntity> {
    const row = await this.stages.findById(id);
    if (!row) throw new TaxonomyEntryNotFoundError();
    return row;
  }

  private async requireSubject(id: number): Promise<SubjectEntity> {
    const row = await this.subjects.findById(id);
    if (!row) throw new TaxonomyEntryNotFoundError();
    return row;
  }
}

/** FR-TAX-2: "required, trimmed, 2–150 characters." @throws {InvalidNameError} */
function validateName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    throw new InvalidNameError();
  }
  return trimmed;
}

function toEducationLevelSummary(row: EducationLevelEntity): EducationLevelSummary {
  return { id: row.id, name: row.name, createdAt: row.createdAt };
}

function toStageSummary(row: StageEntity): StageSummary {
  return { id: row.id, educationLevelId: row.educationLevelId, name: row.name, createdAt: row.createdAt };
}

function toSubjectSummary(row: SubjectEntity): SubjectSummary {
  return { id: row.id, stageId: row.stageId, name: row.name, createdAt: row.createdAt };
}
