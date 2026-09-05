import { Injectable } from '@nestjs/common';
import type { PrismaJsonInput } from '../../../common/prisma/json';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { NotificationChannelRecord, ReviewerGroupRecord } from '../domain/reviewer-group';
import type { CreateReviewerGroupInput, ReviewerGroupRepositoryPort, UpdateReviewerGroupInput } from '../domain/ports';

type Row = {
  id: string;
  tenantId: string;
  name: string;
  members: string[];
  notificationChannels: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** `ReviewerGroup` persistence (Phase 14, BL-052). Every query is explicitly `tenantId`-filtered, mirroring `PrismaSkillRepository`'s convention. */
@Injectable()
export class PrismaReviewerGroupRepository implements ReviewerGroupRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listByTenant(tenantId: string): Promise<ReviewerGroupRecord[]> {
    const rows = await this.prisma.db.reviewerGroup.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return rows.map((row: Row) => this.toRecord(row));
  }

  async findById(tenantId: string, id: string): Promise<ReviewerGroupRecord | null> {
    const row = await this.prisma.db.reviewerGroup.findFirst({ where: { id, tenantId } });
    return row ? this.toRecord(row) : null;
  }

  async findByName(tenantId: string, name: string): Promise<ReviewerGroupRecord | null> {
    const row = await this.prisma.db.reviewerGroup.findFirst({ where: { tenantId, name } });
    return row ? this.toRecord(row) : null;
  }

  async create(input: CreateReviewerGroupInput): Promise<ReviewerGroupRecord> {
    const row = await this.prisma.db.reviewerGroup.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        members: input.members,
        notificationChannels: input.notificationChannels as unknown as PrismaJsonInput,
      },
    });
    return this.toRecord(row);
  }

  async update(tenantId: string, id: string, input: UpdateReviewerGroupInput): Promise<ReviewerGroupRecord | null> {
    const existing = await this.prisma.db.reviewerGroup.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return null;
    }
    const updated = await this.prisma.db.reviewerGroup.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.members !== undefined ? { members: input.members } : {}),
        ...(input.notificationChannels !== undefined
          ? { notificationChannels: input.notificationChannels as unknown as PrismaJsonInput }
          : {}),
      },
    });
    return this.toRecord(updated);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.reviewerGroup.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  private toRecord(row: Row): ReviewerGroupRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      members: row.members,
      notificationChannels: (row.notificationChannels ?? []) as NotificationChannelRecord[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
