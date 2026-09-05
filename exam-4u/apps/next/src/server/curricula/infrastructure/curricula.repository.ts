import type { DataSource, Repository } from 'typeorm';
import { CurriculumDocumentEntity, CurriculumEntity } from '@/server/infrastructure/database';

/**
 * Data access for the tenant-scoped `curriculum` table — adapted from
 * `legacy/api/src/modules/curricula/infrastructure/repositories/curricula.repository.ts`, the
 * ownership/metadata subset relevant to this phase (no `curriculum_document` methods — see
 * `docs/plans/nextjs-rewrite-phase3-plan.md`'s scope-split write-up). Uses the literal table-name
 * string form, never the entity class, per this app's cross-webpack-bundle TypeORM fix.
 */
export class CurriculaRepository {
  private readonly repo: Repository<CurriculumEntity>;
  private readonly documents: Repository<CurriculumDocumentEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository<CurriculumEntity>('curriculum');
    this.documents = dataSource.getRepository<CurriculumDocumentEntity>('curriculum_document');
  }

  async create(entity: CurriculumEntity): Promise<CurriculumEntity> {
    await this.repo.insert(entity);
    return entity;
  }

  async findById(id: string): Promise<CurriculumEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** "List = own (+ all with `curricula.read_all`)". `ownerUserId` is `undefined` for the oversight
   * (all-tenant) listing — the caller (`CurriculaService`) decides which branch to take based on the
   * acting user's effective permissions; this method only expresses the two resulting queries. */
  async findAll(ownerUserId?: string): Promise<CurriculumEntity[]> {
    const where = ownerUserId ? { ownerUserId } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async update(id: string, patch: Partial<Pick<CurriculumEntity, 'name' | 'description'>>): Promise<void> {
    await this.repo.update({ id }, patch);
  }

  /** Hard-deletes the `curriculum` row. Its `curriculum_document` rows cascade away with it
   * (`fk_doc_cur ON DELETE CASCADE`, migration `20260815000008`) — `CurriculaService.delete` is
   * separately responsible for the storage objects and Qdrant chunks those documents own, since no FK
   * can express either. */
  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  // ── `curriculum_document` (Phase 6, sub-slice "6b" — closing Phase 3's own deferral) ────────────

  /** Records one indexed document. Called only by `CurriculumIndexingService`, after its chunks have
   * already been upserted — so a row's existence always implies its chunks were written, never the
   * other way round. */
  async insertDocument(entity: CurriculumDocumentEntity): Promise<CurriculumDocumentEntity> {
    await this.documents.insert(entity);
    return entity;
  }

  /** Every document indexed into a Curriculum, newest first — backs `GET /api/curricula/:id`'s
   * `documents` field. */
  async findDocuments(curriculumId: string): Promise<CurriculumDocumentEntity[]> {
    return this.documents.find({ where: { curriculumId }, order: { uploadedAt: 'DESC' } });
  }

  async findDocumentById(id: string): Promise<CurriculumDocumentEntity | null> {
    return this.documents.findOne({ where: { id } });
  }
}
