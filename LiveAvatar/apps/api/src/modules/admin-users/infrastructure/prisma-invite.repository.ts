import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { InviteRecord } from '../domain/invite';
import type { InviteRepositoryPort } from '../domain/ports';

/**
 * Prisma persistence for admin invites and their tenant scope.
 */
@Injectable()
export class PrismaInviteRepository implements InviteRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param input - New invite
   */
  async create(input: {
    email: string;
    roles: string[];
    tokenHash: string;
    expiresAt: Date;
    createdBy: string;
    tenantIds: string[];
  }): Promise<InviteRecord> {
    const row = await this.prisma.db.adminInvite.create({
      data: {
        email: input.email,
        roles: input.roles,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
        tenants: {
          create: input.tenantIds.map((tenantId) => ({ tenantId })),
        },
      },
      include: { tenants: true },
    });
    return this.toRecord(row);
  }

  /**
   * @param id - Invite id
   */
  async findById(id: string): Promise<InviteRecord | null> {
    const row = await this.prisma.db.adminInvite.findUnique({
      where: { id },
      include: { tenants: true },
    });
    return row ? this.toRecord(row) : null;
  }

  /**
   * @param tokenHash - SHA-256 of the invite token
   */
  async findByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    const row = await this.prisma.db.adminInvite.findUnique({
      where: { tokenHash },
      include: { tenants: true },
    });
    return row ? this.toRecord(row) : null;
  }

  /**
   * @param input - Page + optional pending filter
   */
  async list(input: { page: number; pageSize: number; pendingOnly?: boolean }): Promise<{
    items: InviteRecord[];
    total: number;
  }> {
    const where = input.pendingOnly ? { acceptedAt: null } : {};
    const [rows, total] = await Promise.all([
      this.prisma.db.adminInvite.findMany({
        where,
        include: { tenants: true },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.db.adminInvite.count({ where }),
    ]);
    return { items: rows.map((r: Parameters<typeof this.toRecord>[0]) => this.toRecord(r)), total };
  }

  /**
   * @param id - Invite to mark accepted
   */
  async markAccepted(id: string): Promise<void> {
    await this.prisma.db.adminInvite.update({
      where: { id },
      data: { acceptedAt: new Date() },
    });
  }

  /**
   * @param id - Invite to delete
   */
  async delete(id: string): Promise<void> {
    await this.prisma.db.adminInvite.delete({ where: { id } });
  }

  private toRecord(row: {
    id: string;
    email: string;
    roles: string[];
    tokenHash: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    createdBy: string;
    createdAt: Date;
    tenants: { tenantId: string }[];
  }): InviteRecord {
    return {
      id: row.id,
      email: row.email,
      roles: row.roles,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      tenantIds: row.tenants.map((t) => t.tenantId),
    };
  }
}
