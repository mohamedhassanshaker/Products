import type { DataSource, EntityManager, Repository } from 'typeorm';
import { StoredImageEntity } from '@/server/infrastructure/database';

/**
 * Data access for the tenant-scoped `stored_image` table (migration plan Phase 6, sub-slice "6b") —
 * ported logic from `legacy/api/src/modules/files/infrastructure/repositories/stored-image.repository.ts`.
 * Uses the literal table-name string form (`getRepository<Entity>('table_name')`), never the entity
 * class, per this app's cross-webpack-bundle TypeORM fix.
 *
 * Every method takes an optional `EntityManager` so `ImageAssociationService` can run a multi-table
 * step inside one transaction without this repository needing to know anything about transactions
 * itself (matching legacy's identical signature convention).
 */
export class StoredImageRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(manager?: EntityManager): Repository<StoredImageEntity> {
    return (manager ?? this.dataSource).getRepository<StoredImageEntity>('stored_image');
  }

  /** FR-PDF-11's content-hash dedup lookup — `uq_image_hash` makes this a unique-index probe. */
  async findByHash(fileHash: string, manager?: EntityManager): Promise<StoredImageEntity | null> {
    return this.repo(manager).findOne({ where: { fileHash } });
  }

  async findById(id: string, manager?: EntityManager): Promise<StoredImageEntity | null> {
    return this.repo(manager).findOne({ where: { id } });
  }

  async findByIds(ids: string[], manager?: EntityManager): Promise<StoredImageEntity[]> {
    if (ids.length === 0) return [];
    return this.repo(manager).createQueryBuilder('i').where('i.id IN (:...ids)', { ids }).getMany();
  }

  async insert(entity: StoredImageEntity, manager?: EntityManager): Promise<StoredImageEntity> {
    await this.repo(manager).insert(entity);
    return entity;
  }

  /** Atomic `usage_count = usage_count + 1` — never a read-modify-write from a JS-held value, so a
   * concurrent association on the same image can never clobber the other's increment. */
  async incrementUsageCount(id: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).increment({ id }, 'usageCount', 1);
  }

  /**
   * Atomic `usage_count = GREATEST(usage_count - 1, 0)`, then re-reads and returns the resulting
   * value — the caller (`ImageAssociationService.removeAssociation`) uses that number to decide
   * whether this was the last reference. `GREATEST(..., 0)` is a defensive floor: an already-zero
   * count (only reachable via direct DB manipulation) must never go negative and make the row
   * permanently undeletable.
   */
  async decrementUsageCount(id: string, manager?: EntityManager): Promise<number> {
    const repo = this.repo(manager);
    await repo
      .createQueryBuilder()
      .update(StoredImageEntity)
      .set({ usageCount: () => 'GREATEST(usage_count - 1, 0)' })
      .where('id = :id', { id })
      .execute();
    const row = await repo.findOne({ where: { id } });
    return row?.usageCount ?? 0;
  }

  async delete(id: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).delete({ id });
  }

  /** Persists a vision-captioning pass's WCAG alt text (`ImageCaptioningService`) — also the flag that
   * makes a later hash-dedup reuse of the identical bytes skip re-captioning entirely. */
  async updateGeneratedAltText(id: string, altText: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).update({ id }, { generatedAltText: altText });
  }
}
