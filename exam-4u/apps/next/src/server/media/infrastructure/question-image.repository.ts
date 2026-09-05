import type { DataSource, EntityManager, Repository } from 'typeorm';
import { QuestionImageEntity } from '@/server/infrastructure/database';
import type { QuestionImagePosition } from '../domain/media.types';

/**
 * Data access for the tenant-scoped `question_image` table (migration plan Phase 6, sub-slice "6b") —
 * ported logic from `legacy/api/src/modules/files/infrastructure/repositories/question-image.repository.ts`.
 * Uses the literal table-name string form, never the entity class, per this app's cross-webpack-bundle
 * TypeORM fix; every method takes an optional `EntityManager` so the owning service can compose a
 * multi-table transaction.
 */
export class QuestionImageRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(manager?: EntityManager): Repository<QuestionImageEntity> {
    return (manager ?? this.dataSource).getRepository<QuestionImageEntity>('question_image');
  }

  /** The `uq_qi` tuple lookup backing `associateWithQuestion`'s idempotency. `optionKey` is `null` for
   * every association the automatic extraction pipeline creates (position `question_text`), which
   * MySQL treats as distinct-from-anything in a unique index — hence this explicit `IS NULL` branch
   * rather than a plain equality, so the application-level check matches what the index enforces. */
  async findExisting(
    generatedQuestionId: string,
    imageId: string,
    position: QuestionImagePosition,
    optionKey: string | null,
    manager?: EntityManager,
  ): Promise<QuestionImageEntity | null> {
    const qb = this.repo(manager)
      .createQueryBuilder('qi')
      .where('qi.generated_question_id = :generatedQuestionId', { generatedQuestionId })
      .andWhere('qi.image_id = :imageId', { imageId })
      .andWhere('qi.position = :position', { position });
    if (optionKey === null) qb.andWhere('qi.option_key IS NULL');
    else qb.andWhere('qi.option_key = :optionKey', { optionKey });
    return qb.getOne();
  }

  async insert(entity: QuestionImageEntity, manager?: EntityManager): Promise<QuestionImageEntity> {
    await this.repo(manager).insert(entity);
    return entity;
  }

  /** Reads the row, then deletes it, returning what was deleted so the caller can decrement the right
   * image's usage count. Deliberately read-then-delete (not a single statement) because MySQL has no
   * `DELETE ... RETURNING`; the caller always runs this inside a transaction, which is what makes the
   * two statements atomic with respect to any concurrent remover. */
  async deleteAndReturn(id: string, manager?: EntityManager): Promise<QuestionImageEntity | null> {
    const repo = this.repo(manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) return null;
    await repo.delete({ id });
    return existing;
  }

  /** Every association for the given questions, in a stable page/sequence order — batched so a review
   * page listing many questions costs one query, not one per question. */
  async findForQuestions(generatedQuestionIds: string[], manager?: EntityManager): Promise<QuestionImageEntity[]> {
    if (generatedQuestionIds.length === 0) return [];
    return this.repo(manager)
      .createQueryBuilder('qi')
      .where('qi.generated_question_id IN (:...ids)', { ids: generatedQuestionIds })
      .orderBy('qi.sequence_order', 'ASC')
      .addOrderBy('qi.id', 'ASC')
      .getMany();
  }
}
