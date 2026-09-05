import { Injectable } from '@nestjs/common';
import type { PrismaJsonInput } from '../../../common/prisma/json';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProbeStatus, ProviderCategory, ProviderCredentialRecord } from '../domain/provider';
import type { ProviderCredentialRepositoryPort } from '../domain/ports';

/** Prisma row shape for `ProviderCredential`. */
type Row = {
  id: string;
  tenantId: string;
  providerKey: string;
  displayLabel: string;
  endpointUrl: string;
  credentialRef: string | null;
  extra: unknown;
  lastProbeStatus: string;
  lastProbeAt: Date | null;
  lastProbeError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Per-tenant credential persistence (FR-PROVIDER-2/3). Runs through the
 * guarded `prisma.db` client so `tenantId` is auto-injected on create and
 * auto-scoped on every read/write from the ambient `TenantContext` set by
 * `TenantContextInterceptor` — the same pattern `PrismaTenantRepository`
 * uses for `Tenant`'s children.
 */
@Injectable()
export class PrismaProviderCredentialRepository implements ProviderCredentialRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @param input - Fields to persist */
  async create(input: {
    tenantId: string;
    providerKey: string;
    displayLabel: string;
    endpointUrl: string;
    credentialRef: string | null;
    extra: Record<string, unknown>;
  }): Promise<ProviderCredentialRecord> {
    const row = await this.prisma.db.providerCredential.create({
      data: {
        tenantId: input.tenantId,
        providerKey: input.providerKey,
        displayLabel: input.displayLabel,
        endpointUrl: input.endpointUrl,
        credentialRef: input.credentialRef,
        extra: input.extra as PrismaJsonInput,
      },
    });
    return this.toRecord(row);
  }

  /**
   * @param tenantId - Owning tenant
   * @param id - Credential id
   */
  async findById(tenantId: string, id: string): Promise<ProviderCredentialRecord | null> {
    const row = await this.prisma.db.providerCredential.findFirst({ where: { id, tenantId } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * @param tenantId - Owning tenant
   * @param providerKey - Catalog key
   * @param displayLabel - Distinguishing label (defaults to "default")
   */
  async findByLabel(
    tenantId: string,
    providerKey: string,
    displayLabel: string,
  ): Promise<ProviderCredentialRecord | null> {
    const row = await this.prisma.db.providerCredential.findFirst({
      where: { tenantId, providerKey, displayLabel },
    });
    return row ? this.toRecord(row) : null;
  }

  /**
   * @param tenantId - Owning tenant
   * @param filter - Optional category (joined via ProviderDefinition) / provider_key filters
   */
  async list(
    tenantId: string,
    filter: { category?: ProviderCategory; providerKey?: string },
  ): Promise<ProviderCredentialRecord[]> {
    const rows = await this.prisma.db.providerCredential.findMany({
      where: {
        tenantId,
        ...(filter.providerKey ? { providerKey: filter.providerKey } : {}),
        ...(filter.category ? { definition: { category: filter.category } } : {}),
      },
      orderBy: [{ providerKey: 'asc' }, { displayLabel: 'asc' }],
    });
    return rows.map((r: Row) => this.toRecord(r));
  }

  /**
   * Cross-tenant read for the `provider-probe` job (LLD §8.8) — deliberately
   * bypasses the guard since it must see every active tenant's credentials,
   * not one tenant's.
   */
  async listAllActive(): Promise<ProviderCredentialRecord[]> {
    return this.prisma.withBypass(async () => {
      const rows = await this.prisma.db.providerCredential.findMany({
        where: { tenant: { status: 'active' } },
      });
      return rows.map((r: Row) => this.toRecord(r));
    });
  }

  /**
   * @param tenantId - Owning tenant
   * @param id - Credential id
   * @param input - Partial fields
   * @param ifMatch - Caller's `updated_at` for optimistic concurrency
   */
  async update(
    tenantId: string,
    id: string,
    input: Partial<{
      endpointUrl: string;
      credentialRef: string | null;
      displayLabel: string;
      extra: Record<string, unknown>;
    }>,
    ifMatch: Date,
  ): Promise<ProviderCredentialRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.providerCredential.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return 'missing';
    }
    const result = await this.prisma.db.providerCredential.updateMany({
      where: { id, tenantId, updatedAt: ifMatch },
      data: {
        ...(input.endpointUrl !== undefined ? { endpointUrl: input.endpointUrl } : {}),
        ...(input.credentialRef !== undefined ? { credentialRef: input.credentialRef } : {}),
        ...(input.displayLabel !== undefined ? { displayLabel: input.displayLabel } : {}),
        ...(input.extra !== undefined ? { extra: input.extra as PrismaJsonInput } : {}),
      },
    });
    if (result.count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.providerCredential.findFirst({ where: { id, tenantId } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  /**
   * @param tenantId - Owning tenant
   * @param id - Credential id
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.providerCredential.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  /**
   * @param tenantId - Owning tenant
   * @param id - Credential id
   * @param result - Probe outcome to persist
   */
  async recordProbeResult(
    tenantId: string,
    id: string,
    result: { status: ProbeStatus; error: string | null; probedAt: Date },
  ): Promise<void> {
    await this.prisma.db.providerCredential.updateMany({
      where: { id, tenantId },
      data: {
        lastProbeStatus: result.status,
        lastProbeAt: result.probedAt,
        lastProbeError: result.error,
      },
    });
  }

  private toRecord(row: Row): ProviderCredentialRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      providerKey: row.providerKey,
      displayLabel: row.displayLabel,
      endpointUrl: row.endpointUrl,
      credentialRef: row.credentialRef,
      extra: (row.extra ?? {}) as Record<string, unknown>,
      lastProbeStatus: row.lastProbeStatus as ProbeStatus,
      lastProbeAt: row.lastProbeAt,
      lastProbeError: row.lastProbeError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
