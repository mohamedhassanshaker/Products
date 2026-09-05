import { randomUUID } from 'node:crypto';
import type { SubjectRepository } from '@/server/taxonomy';
import type { PermissionResolutionService } from '@/server/rbac';
import { logger } from '@/server/logging';
import { CurriculaRepository } from '../infrastructure/curricula.repository';
import type { CurriculumIndexingService } from './curriculum-indexing.service';
import { CurriculumNotFoundError, NotCurriculumOwnerError, SubjectNotFoundError } from '../domain/errors';
import type { CreateCurriculumInput, CurriculumSummary, UpdateCurriculumInput } from '../domain/curricula.types';
import type { CurriculumEntity } from '@/server/infrastructure/database';

/** The one non-tenant-wide permission that grants the "Tenant Admin acting in an oversight capacity"
 * bypass for read/modify/delete of a Curriculum one does not own (FR-CUR-1). */
const OVERSIGHT_PERMISSION = 'curricula.read_all';

/**
 * FR-CUR-1/FR-CUR-1a's ownership/metadata business logic — adapted from
 * `legacy/api/src/modules/curricula/application/curricula.service.ts`'s `CurriculaService`, narrowed
 * to the ownership/metadata half of that class (see `docs/plans/nextjs-rewrite-phase3-plan.md`'s
 * scope-split write-up for why document upload/ingestion/search are deliberately not part of this
 * class at all, rather than stubbed).
 *
 * **Ownership** (mirrors HLD §5.2 — "ownership checks are not guards, enforced inside the application
 * service"): every method that reads/mutates a specific Curriculum loads it first, then calls
 * {@link assertOwnerOrOversight} (owner **or** the tenant-wide `curricula.read_all` permission) before
 * doing anything else. `NotCurriculumOwnerError` -> 403 `NOT_CURRICULUM_OWNER`, never a 404.
 *
 * Unlike legacy's identical class, every method here takes `actingUserId` as an explicit parameter
 * rather than reading it from ambient request context — this app's plain-class composition convention
 * (established by `UsersService`/`ProfileService`) keeps request-context reads confined to Route
 * Handlers, not application services.
 */
export class CurriculaService {
  constructor(
    private readonly repository: CurriculaRepository,
    private readonly subjects: SubjectRepository,
    private readonly permissions: PermissionResolutionService,
    private readonly indexing: CurriculumIndexingService,
  ) {}

  /** FR-CUR-1: creates a Curriculum owned by `actingUserId`, scoped to a real Subject.
   * @throws {SubjectNotFoundError} if `input.subjectId` does not exist in this tenant. */
  async create(actingUserId: string, input: CreateCurriculumInput): Promise<CurriculumSummary> {
    const subject = await this.subjects.findById(input.subjectId);
    if (!subject) throw new SubjectNotFoundError();

    const entity: CurriculumEntity = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      subjectId: input.subjectId,
      ownerUserId: actingUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.repository.create(entity);
    return toSummary(entity);
  }

  /** "List = own (+ all with `curricula.read_all`)". */
  async list(actingUserId: string): Promise<CurriculumSummary[]> {
    const hasOversight = await this.permissions.hasPermission(actingUserId, OVERSIGHT_PERMISSION);
    const rows = await this.repository.findAll(hasOversight ? undefined : actingUserId);
    return rows.map(toSummary);
  }

  /** @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError} */
  async get(actingUserId: string, id: string): Promise<CurriculumSummary> {
    const curriculum = await this.requireCurriculum(id);
    await this.assertOwnerOrOversight(actingUserId, curriculum);
    return toSummary(curriculum);
  }

  /** @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError} */
  async update(actingUserId: string, id: string, input: UpdateCurriculumInput): Promise<CurriculumSummary> {
    const curriculum = await this.requireCurriculum(id);
    await this.assertOwnerOrOversight(actingUserId, curriculum);

    const patch: Partial<Pick<CurriculumEntity, 'name' | 'description'>> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (Object.keys(patch).length > 0) {
      await this.repository.update(id, patch);
    }

    return this.get(actingUserId, id);
  }

  /**
   * Hard-deletes the Curriculum row. Its `curriculum_document` rows cascade away via `fk_doc_cur`, but
   * no FK can reach into Qdrant — so this also deletes the Curriculum's indexed chunks (Phase 6
   * sub-slice "6b", once document ingestion made those chunks possible; Phase 3's version of this
   * method correctly had nothing to clean up).
   *
   * The chunk delete is **best-effort**: a transient vector-store outage is logged, not propagated —
   * failing the delete the user explicitly asked for (and which the DB has no reason to refuse) would
   * be a worse outcome than a small, self-healing orphan in the vector store, which is unreachable
   * anyway once its `curriculum_document` rows are gone. It runs BEFORE the row delete so a successful
   * pass never leaves chunks behind for a Curriculum id that no longer exists.
   *
   * @throws {CurriculumNotFoundError} @throws {NotCurriculumOwnerError}
   */
  async delete(actingUserId: string, tenantId: string, id: string): Promise<void> {
    const curriculum = await this.requireCurriculum(id);
    await this.assertOwnerOrOversight(actingUserId, curriculum);
    await this.indexing.deleteChunksForCurriculum(tenantId, id).catch((err: unknown) => {
      logger.error({ err, curriculumId: id }, 'curriculum_chunk_cleanup_failed');
    });
    await this.repository.delete(id);
  }

  private async requireCurriculum(id: string): Promise<CurriculumEntity> {
    const curriculum = await this.repository.findById(id);
    if (!curriculum) throw new CurriculumNotFoundError();
    return curriculum;
  }

  private async assertOwnerOrOversight(actingUserId: string, curriculum: CurriculumEntity): Promise<void> {
    if (curriculum.ownerUserId === actingUserId) return;
    if (await this.permissions.hasPermission(actingUserId, OVERSIGHT_PERMISSION)) return;
    throw new NotCurriculumOwnerError();
  }
}

function toSummary(entity: CurriculumEntity): CurriculumSummary {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    subjectId: entity.subjectId,
    ownerUserId: entity.ownerUserId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
