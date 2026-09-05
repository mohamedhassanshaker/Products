import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PublishedConfigLookupPort } from '../domain/ports';

/**
 * Checks whether a tenant's **published** `DeploymentConfig` denormalized
 * provider columns reference the given provider key (FR-PROVIDER-2's delete
 * guard). Reads the `deployment-config` module's table directly rather than
 * importing its classes — the same shared-table pattern
 * `PrismaTenantRepository` already uses for its Screen-3 summary column, so
 * `providers` and `deployment-config` stay decoupled at the class-import
 * level (LLD §3.1) while agreeing on one row per tenant.
 */
@Injectable()
export class PrismaPublishedConfigLookup implements PublishedConfigLookupPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param tenantId - Owning tenant
   * @param providerKey - Candidate provider key to check
   */
  async isProviderInUse(tenantId: string, providerKey: string): Promise<boolean> {
    const config = await this.prisma.db.deploymentConfig.findFirst({
      where: { tenantId, status: 'published' },
    });
    if (!config) {
      return false;
    }
    return (
      config.transportProvider === providerKey ||
      config.sttProvider === providerKey ||
      config.llmProvider === providerKey ||
      config.llmFallbackProvider === providerKey ||
      config.ttsProvider === providerKey ||
      config.avatarProvider === providerKey
    );
  }
}
