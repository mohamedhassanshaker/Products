import { Injectable } from '@nestjs/common';
import type { PrismaJsonInput } from '../../../common/prisma/json';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ToolDefinitionRecord, ToolLane } from '../domain/tool-definition';
import type {
  CreateToolDefinitionInput,
  ToolDefinitionRepositoryPort,
  UpdateToolDefinitionInput,
} from '../domain/ports';

/** Prisma row shape for `ToolDefinition`. */
type Row = {
  id: string;
  tenantId: string;
  apiRef: string;
  name: string;
  description: string | null;
  method: string;
  url: string;
  credentialRef: string | null;
  requiresCredential?: boolean;
  argsSchema: unknown;
  enabled: boolean;
  consequential?: boolean;
  autonomousUseAckText?: string | null;
  lane?: string;
  perSessionCap?: number | null;
  perTurnCap?: number | null;
  timeoutMs?: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * `ToolDefinition` persistence (FR-AGENT-2, LLD §4.3). Every query is
 * explicitly `tenantId`-filtered, so the `tenantGuard` extension's ALS
 * injection is never required — this repository is read by both the
 * admin-JWT-scoped `deployment-config` validator and the unauthenticated
 * `/internal` surface (no `TenantContextInterceptor` runs on either path
 * for a bare `tenantId`, matching the existing `sessions`/`providers`
 * repositories' pattern). Phase 8 (BL-033) adds `findById`/`findByApiRef`/
 * `create`/`update`/`delete` to what was previously a read-only adapter.
 */
@Injectable()
export class PrismaToolDefinitionRepository implements ToolDefinitionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async listByTenant(tenantId: string): Promise<ToolDefinitionRecord[]> {
    const rows = await this.prisma.db.toolDefinition.findMany({ where: { tenantId } });
    return rows.map((row: Row) => this.toRecord(row));
  }

  /** @inheritdoc */
  async listEnabledByApiRefs(tenantId: string, apiRefs: string[]): Promise<ToolDefinitionRecord[]> {
    if (apiRefs.length === 0) {
      return [];
    }
    const rows = await this.prisma.db.toolDefinition.findMany({
      where: { tenantId, enabled: true, apiRef: { in: apiRefs } },
    });
    return rows.map((row: Row) => this.toRecord(row));
  }

  /** @inheritdoc */
  async findById(tenantId: string, id: string): Promise<ToolDefinitionRecord | null> {
    const row = await this.prisma.db.toolDefinition.findFirst({ where: { id, tenantId } });
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async findByApiRef(tenantId: string, apiRef: string): Promise<ToolDefinitionRecord | null> {
    const row = await this.prisma.db.toolDefinition.findFirst({ where: { tenantId, apiRef } });
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async create(input: CreateToolDefinitionInput): Promise<ToolDefinitionRecord> {
    const row = await this.prisma.db.toolDefinition.create({
      data: {
        tenantId: input.tenantId,
        apiRef: input.apiRef,
        name: input.name,
        description: input.description,
        method: input.method,
        url: input.url,
        credentialRef: input.credentialRef,
        requiresCredential: input.requiresCredential,
        argsSchema: input.argsSchema as PrismaJsonInput,
        enabled: input.enabled,
        consequential: input.consequential,
        autonomousUseAckText: input.autonomousUseAckText,
        lane: input.lane,
        perSessionCap: input.perSessionCap,
        perTurnCap: input.perTurnCap,
        timeoutMs: input.timeoutMs,
      },
    });
    return this.toRecord(row);
  }

  /** @inheritdoc */
  async update(
    tenantId: string,
    id: string,
    input: UpdateToolDefinitionInput,
    ifMatch: Date,
  ): Promise<ToolDefinitionRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.toolDefinition.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return 'missing';
    }
    const result = await this.prisma.db.toolDefinition.updateMany({
      where: { id, tenantId, updatedAt: ifMatch },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.credentialRef !== undefined ? { credentialRef: input.credentialRef } : {}),
        ...(input.requiresCredential !== undefined ? { requiresCredential: input.requiresCredential } : {}),
        ...(input.argsSchema !== undefined ? { argsSchema: input.argsSchema as PrismaJsonInput } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.consequential !== undefined ? { consequential: input.consequential } : {}),
        ...(input.autonomousUseAckText !== undefined ? { autonomousUseAckText: input.autonomousUseAckText } : {}),
        ...(input.lane !== undefined ? { lane: input.lane } : {}),
        ...(input.perSessionCap !== undefined ? { perSessionCap: input.perSessionCap } : {}),
        ...(input.perTurnCap !== undefined ? { perTurnCap: input.perTurnCap } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      },
    });
    if (result.count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.toolDefinition.findFirst({ where: { id, tenantId } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  /** @inheritdoc */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.toolDefinition.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  private toRecord(row: Row): ToolDefinitionRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      apiRef: row.apiRef,
      name: row.name,
      description: row.description,
      method: row.method,
      url: row.url,
      credentialRef: row.credentialRef,
      requiresCredential: row.requiresCredential ?? false,
      argsSchema: (row.argsSchema ?? {}) as Record<string, unknown>,
      enabled: row.enabled,
      consequential: row.consequential ?? false,
      autonomousUseAckText: row.autonomousUseAckText ?? null,
      lane: (row.lane as ToolLane) ?? 'foreground',
      perSessionCap: row.perSessionCap ?? null,
      perTurnCap: row.perTurnCap ?? null,
      timeoutMs: row.timeoutMs ?? 10000,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
