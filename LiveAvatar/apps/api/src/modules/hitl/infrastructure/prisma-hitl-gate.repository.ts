import { Injectable } from '@nestjs/common';
import type { PrismaJsonInput } from '../../../common/prisma/json';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { HitlAttachmentKind, HitlGateRecord, HitlGateStatus, HitlGateType, HitlTimeoutBehavior } from '../domain/hitl-gate';
import type { CreateHitlGateInput, HitlGateRepositoryPort, UpdateHitlGateInput } from '../domain/ports';

type Row = {
  id: string;
  tenantId: string;
  attachmentKind: string;
  attachmentRef: string;
  triggerCondition: unknown;
  gateType: string;
  reviewerGroupId: string;
  slaSeconds: number;
  holdTreatmentText: string;
  timeoutBehavior: string;
  escalateToGroupId: string | null;
  autoApproveAckText: string | null;
  notifyChannels: string[];
  environments: string[];
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** `HitlGate` persistence (Phase 14, BL-052/053/054). */
@Injectable()
export class PrismaHitlGateRepository implements HitlGateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listByTenant(tenantId: string): Promise<HitlGateRecord[]> {
    const rows = await this.prisma.db.hitlGate.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row: Row) => this.toRecord(row));
  }

  async findById(tenantId: string, id: string): Promise<HitlGateRecord | null> {
    const row = await this.prisma.db.hitlGate.findFirst({ where: { id, tenantId } });
    return row ? this.toRecord(row) : null;
  }

  async findByIdAnyTenant(id: string): Promise<HitlGateRecord | null> {
    const row = await this.prisma.db.hitlGate.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByAttachment(tenantId: string, attachmentKind: HitlAttachmentKind, attachmentRef: string): Promise<HitlGateRecord[]> {
    const rows = await this.prisma.db.hitlGate.findMany({ where: { tenantId, attachmentKind, attachmentRef } });
    return rows.map((row: Row) => this.toRecord(row));
  }

  async create(input: CreateHitlGateInput): Promise<HitlGateRecord> {
    const row = await this.prisma.db.hitlGate.create({
      data: {
        tenantId: input.tenantId,
        attachmentKind: input.attachmentKind,
        attachmentRef: input.attachmentRef,
        triggerCondition: input.triggerCondition as PrismaJsonInput,
        gateType: input.gateType,
        reviewerGroupId: input.reviewerGroupId,
        slaSeconds: input.slaSeconds,
        holdTreatmentText: input.holdTreatmentText,
        timeoutBehavior: input.timeoutBehavior,
        escalateToGroupId: input.escalateToGroupId,
        autoApproveAckText: input.autoApproveAckText,
        notifyChannels: input.notifyChannels,
        environments: input.environments,
        status: input.status,
        createdBy: input.createdBy,
      },
    });
    return this.toRecord(row);
  }

  async update(tenantId: string, id: string, input: UpdateHitlGateInput): Promise<HitlGateRecord | null> {
    const existing = await this.prisma.db.hitlGate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return null;
    }
    const updated = await this.prisma.db.hitlGate.update({
      where: { id },
      data: {
        ...(input.attachmentKind !== undefined ? { attachmentKind: input.attachmentKind } : {}),
        ...(input.attachmentRef !== undefined ? { attachmentRef: input.attachmentRef } : {}),
        ...(input.triggerCondition !== undefined ? { triggerCondition: input.triggerCondition as PrismaJsonInput } : {}),
        ...(input.gateType !== undefined ? { gateType: input.gateType } : {}),
        ...(input.reviewerGroupId !== undefined ? { reviewerGroupId: input.reviewerGroupId } : {}),
        ...(input.slaSeconds !== undefined ? { slaSeconds: input.slaSeconds } : {}),
        ...(input.holdTreatmentText !== undefined ? { holdTreatmentText: input.holdTreatmentText } : {}),
        ...(input.timeoutBehavior !== undefined ? { timeoutBehavior: input.timeoutBehavior } : {}),
        ...(input.escalateToGroupId !== undefined ? { escalateToGroupId: input.escalateToGroupId } : {}),
        ...(input.autoApproveAckText !== undefined ? { autoApproveAckText: input.autoApproveAckText } : {}),
        ...(input.notifyChannels !== undefined ? { notifyChannels: input.notifyChannels } : {}),
        ...(input.environments !== undefined ? { environments: input.environments } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    return this.toRecord(updated);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.hitlGate.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  private toRecord(row: Row): HitlGateRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      attachmentKind: row.attachmentKind as HitlAttachmentKind,
      attachmentRef: row.attachmentRef,
      triggerCondition: (row.triggerCondition ?? {}) as Record<string, unknown>,
      gateType: row.gateType as HitlGateType,
      reviewerGroupId: row.reviewerGroupId,
      slaSeconds: row.slaSeconds,
      holdTreatmentText: row.holdTreatmentText,
      timeoutBehavior: row.timeoutBehavior as HitlTimeoutBehavior,
      escalateToGroupId: row.escalateToGroupId,
      autoApproveAckText: row.autoApproveAckText,
      notifyChannels: row.notifyChannels as ('in_app' | 'email')[],
      environments: row.environments,
      status: row.status as HitlGateStatus,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
