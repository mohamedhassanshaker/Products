import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { TenantRecord } from '../domain/tenant';
import type { TenantRepositoryPort } from '../domain/ports';

/** Prisma row shape needed to build a `TenantRecord`. */
type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused';
  roomNamespace: string;
  createdAt: Date;
  updatedAt: Date;
  config: { status: 'draft' | 'published'; llmProvider: string | null; ttsProvider: string | null; avatarProvider: string | null } | null;
};

/**
 * Prisma persistence for tenants (FR-TENANT-1/2/3/4). `Tenant` itself is not
 * in the tenantGuard's tenant-scoped model set (LLD §4.1's guard list) — it
 * is the scoping root, so these queries are unfiltered by design.
 */
@Injectable()
export class PrismaTenantRepository implements TenantRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @param input - name, slug, initial status */
  async create(input: { name: string; slug: string; status: 'active' | 'paused' }): Promise<TenantRecord> {
    const row = await this.prisma.db.tenant.create({
      data: { name: input.name, slug: input.slug, status: input.status, roomNamespace: input.slug },
      include: { config: true },
    });
    return this.toRecord(row);
  }

  /** @param id - Tenant id */
  async findById(id: string): Promise<TenantRecord | null> {
    const row = await this.prisma.db.tenant.findUnique({ where: { id }, include: { config: true } });
    return row ? this.toRecord(row) : null;
  }

  /** @param slug - Candidate slug */
  async findBySlug(slug: string): Promise<TenantRecord | null> {
    const row = await this.prisma.db.tenant.findUnique({ where: { slug }, include: { config: true } });
    return row ? this.toRecord(row) : null;
  }

  /** @returns Total tenant count (FR-TENANT-1 500-tenant limit) */
  async count(): Promise<number> {
    return this.prisma.db.tenant.count();
  }

  /** @param input - Search/filter/pagination/assignment scope */
  async list(input: {
    q?: string;
    status?: 'active' | 'paused';
    page: number;
    pageSize: number;
    tenantIds?: string[] | null;
  }): Promise<{ items: TenantRecord[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (input.status) {
      where.status = input.status;
    }
    if (input.q) {
      where.name = { contains: input.q, mode: 'insensitive' };
    }
    if (input.tenantIds !== null && input.tenantIds !== undefined) {
      where.id = { in: input.tenantIds };
    }

    const [rows, total] = await Promise.all([
      this.prisma.db.tenant.findMany({
        where,
        include: { config: true },
        orderBy: { updatedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.db.tenant.count({ where }),
    ]);
    return { items: rows.map((r: Parameters<typeof this.toRecord>[0]) => this.toRecord(r)), total };
  }

  /**
   * @param id - Tenant id
   * @param name - New name
   * @param ifMatch - Caller's `updated_at` for optimistic concurrency
   */
  async updateName(id: string, name: string, ifMatch: Date): Promise<TenantRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.tenant.findUnique({ where: { id } });
    if (!existing) {
      return 'missing';
    }
    const result = await this.prisma.db.tenant.updateMany({
      where: { id, updatedAt: ifMatch },
      data: { name },
    });
    if (result.count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.tenant.findUnique({ where: { id }, include: { config: true } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  /**
   * @param id - Tenant id
   * @param status - `active` or `paused`
   */
  async updateStatus(id: string, status: 'active' | 'paused'): Promise<TenantRecord | null> {
    try {
      const row = await this.prisma.db.tenant.update({
        where: { id },
        data: { status },
        include: { config: true },
      });
      return this.toRecord(row);
    } catch {
      return null;
    }
  }

  /**
   * Summarizes the deployment's provider stack for Screen 3's list column.
   * Phase 1 creates an empty draft config for every tenant, so the summary
   * is either "Not configured" (draft, no providers chosen) or a compact
   * provider list once Phase 2's Agent Builder starts populating it.
   * @param row - Tenant row with its config relation
   */
  private summarizeProviderStack(row: TenantRow): string {
    const c = row.config;
    if (!c || (!c.llmProvider && !c.ttsProvider && !c.avatarProvider)) {
      return 'Not configured';
    }
    const parts = [c.llmProvider, c.ttsProvider, c.avatarProvider].filter(Boolean);
    return `${c.status === 'published' ? 'Published' : 'Draft'} — ${parts.join(', ')}`;
  }

  private toRecord(row: TenantRow): TenantRecord {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      roomNamespace: row.roomNamespace,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      providerStackSummary: this.summarizeProviderStack(row),
    };
  }
}
