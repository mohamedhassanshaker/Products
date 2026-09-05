import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { parseAgentConfigYaml } from '../domain/agent-config';
import type { PartialAgentConfig } from '../domain/agent-config';
import type { DeploymentConfigRecord, DeploymentConfigRepositoryPort } from '../domain/ports';

/** Prisma row shape for `DeploymentConfig`. */
type Row = {
  id: string;
  tenantId: string;
  yamlText: string;
  status: 'draft' | 'published';
  transportProvider: string | null;
  sttProvider: string | null;
  llmProvider: string | null;
  llmFallbackProvider: string | null;
  ttsProvider: string | null;
  avatarProvider: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  publishedAt: Date | null;
  pendingRollbackFromVersionId: string | null;
};

/**
 * Deployment config persistence (FR-CONFIG-3). One row per tenant, created
 * empty by `CreateTenantUseCase` (Phase 1) — `save` always updates, never
 * inserts, so a missing row means an unknown/foreign tenant id.
 */
@Injectable()
export class PrismaDeploymentConfigRepository implements DeploymentConfigRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @param tenantId - Owning tenant */
  async findByTenantId(tenantId: string): Promise<DeploymentConfigRecord | null> {
    const row = await this.prisma.db.deploymentConfig.findFirst({ where: { tenantId } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * @param tenantId - Owning tenant
   * @param input - New yaml/status/denormalized providers
   * @param ifMatch - Caller's `updated_at` for optimistic concurrency
   */
  async save(
    tenantId: string,
    input: {
      yamlText: string;
      status: 'draft' | 'published';
      providers: DeploymentConfigRecord['providers'];
      updatedBy: string | null;
      publishedAt?: Date;
      createVersion?: { publishedAt: Date; createdBy: string | null };
      pendingRollbackFromVersionId?: string | null;
    },
    ifMatch: Date,
  ): Promise<DeploymentConfigRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.deploymentConfig.findFirst({ where: { tenantId } });
    if (!existing) {
      return 'missing';
    }

    // Phase 9 (BL-035): a publish (`createVersion` set) inserts one
    // ConfigVersion row and reads/clears `pendingRollbackFromVersionId` in
    // the *same* transaction as the DeploymentConfig update, so the
    // pointer row and the version-history row can never disagree
    // (`ARCHITECTURE_NOTES.md` §2).
    const rolledBackFrom = input.createVersion ? existing.pendingRollbackFromVersionId : undefined;
    const pendingRollbackFromVersionId = input.createVersion ? null : input.pendingRollbackFromVersionId;

    const count = await this.prisma.db.$transaction(async (tx) => {
      const updateResult = await tx.deploymentConfig.updateMany({
        where: { tenantId, updatedAt: ifMatch },
        data: {
          yamlText: input.yamlText,
          status: input.status,
          transportProvider: input.providers.transport,
          sttProvider: input.providers.stt,
          llmProvider: input.providers.llm,
          llmFallbackProvider: input.providers.llmFallback,
          ttsProvider: input.providers.tts,
          avatarProvider: input.providers.avatar,
          updatedBy: input.updatedBy,
          ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
          ...(pendingRollbackFromVersionId !== undefined ? { pendingRollbackFromVersionId } : {}),
        },
      });
      if (updateResult.count === 0) {
        return 0;
      }
      if (input.createVersion) {
        const last = await tx.configVersion.findFirst({ where: { tenantId }, orderBy: { versionNumber: 'desc' } });
        const nextVersion = (last?.versionNumber ?? 0) + 1;
        await tx.configVersion.updateMany({ where: { tenantId, status: 'published' }, data: { status: 'superseded' } });
        await tx.configVersion.create({
          data: {
            tenantId,
            versionNumber: nextVersion,
            yamlText: input.yamlText,
            status: 'published',
            publishedAt: input.createVersion.publishedAt,
            createdBy: input.createVersion.createdBy,
            rolledBackFrom: rolledBackFrom ?? null,
          },
        });
      }
      return updateResult.count;
    });

    if (count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.deploymentConfig.findFirst({ where: { tenantId } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  private toRecord(row: Row): DeploymentConfigRecord {
    let structured: PartialAgentConfig = {};
    if (row.yamlText) {
      try {
        structured = parseAgentConfigYaml(row.yamlText) as PartialAgentConfig;
      } catch {
        structured = {};
      }
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      yamlText: row.yamlText,
      status: row.status,
      providers: {
        transport: row.transportProvider,
        stt: row.sttProvider,
        llm: row.llmProvider,
        llmFallback: row.llmFallbackProvider,
        tts: row.ttsProvider,
        avatar: row.avatarProvider,
      },
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      publishedAt: row.publishedAt,
      structured,
      pendingRollbackFromVersionId: row.pendingRollbackFromVersionId,
    };
  }
}
