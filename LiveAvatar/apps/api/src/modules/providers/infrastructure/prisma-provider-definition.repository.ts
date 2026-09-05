import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProviderCategory, ProviderDefinitionRecord } from '../domain/provider';
import type { ProviderDefinitionRepositoryPort } from '../domain/ports';

/** Prisma row shape for `ProviderDefinition`. */
type Row = {
  key: string;
  category: string;
  displayName: string;
  hosting: string;
  interfaceName: string;
  requiresCredential: boolean;
  enabled: boolean;
  featureGaps: string | null;
};

/**
 * Catalog persistence (FR-PROVIDER-1). `ProviderDefinition` is a
 * platform-global table (not tenant-scoped), so these queries run outside
 * `TenantContext` on purpose — it is not in the `tenantGuard` model set.
 */
@Injectable()
export class PrismaProviderDefinitionRepository implements ProviderDefinitionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @param filter - Optional category/enabled filters */
  async list(filter: { category?: ProviderCategory; enabled?: boolean }): Promise<ProviderDefinitionRecord[]> {
    const rows = await this.prisma.db.providerDefinition.findMany({
      where: {
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.enabled !== undefined ? { enabled: filter.enabled } : {}),
      },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return rows.map((r: Row) => this.toRecord(r));
  }

  /** @param key - Catalog key */
  async findByKey(key: string): Promise<ProviderDefinitionRecord | null> {
    const row = await this.prisma.db.providerDefinition.findUnique({ where: { key } });
    return row ? this.toRecord(row) : null;
  }

  /** @param category - Category to count within */
  async countEnabledInCategory(category: ProviderCategory): Promise<number> {
    return this.prisma.db.providerDefinition.count({ where: { category, enabled: true } });
  }

  /**
   * @param key - Catalog key
   * @param enabled - Target state
   */
  async setEnabled(key: string, enabled: boolean): Promise<ProviderDefinitionRecord | null> {
    try {
      const row = await this.prisma.db.providerDefinition.update({ where: { key }, data: { enabled } });
      return this.toRecord(row);
    } catch {
      return null;
    }
  }

  private toRecord(row: Row): ProviderDefinitionRecord {
    return {
      key: row.key,
      category: row.category as ProviderDefinitionRecord['category'],
      displayName: row.displayName,
      hosting: row.hosting as ProviderDefinitionRecord['hosting'],
      interfaceName: row.interfaceName,
      requiresCredential: row.requiresCredential,
      enabled: row.enabled,
      featureGaps: row.featureGaps,
    };
  }
}
