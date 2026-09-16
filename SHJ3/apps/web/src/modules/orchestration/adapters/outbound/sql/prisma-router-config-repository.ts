import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  AgentSelectionScope,
  ConflictResolution,
  ExecutionMode,
  MergePolicy,
  RoutingStrategy,
} from "../../../domain/router-config-vocabulary.js";
import type {
  CreateDefaultRouterConfigInput,
  RouterConfigRepository,
  RouterConfigRow,
  UpdateRouterConfigInput,
} from "../../../ports/router-config-repository.js";

/**
 * `sewa`'s own real, persisted `RouterConfigs` row, confirmed live (`sqlcmd` against the
 * real dev database) rather than assumed from the seed script's source alone — the exact
 * values `ProvisionDefaultRouterConfigForTenant` needs every other tenant to start with.
 * See that use case's own doc comment for why this deliberately does NOT reuse `apps/ai`'s
 * separate in-memory `_DEFAULT_ROUTER_CONFIG` fallback (`orchestration_repository.py`),
 * which independently hardcodes `min_routing_confidence=0.55` against this row's real 0.30.
 */
const SEWA_MIRRORED_DEFAULTS = {
  executionMode: "Sequential",
  routingStrategy: "IntentClassifier",
  agentSelectionScope: "AllPublished",
  agentScopeListJson: null,
  maxHops: 6,
  maxLoopIterations: 3,
  costCeilingTokens: 8000,
  costCeilingMicroAed: 350_000n,
  conflictResolution: "HighestConfidence",
  responseMergePolicy: "DeduplicateOverlap",
  fallbackAgentId: null,
  minRoutingConfidence: 0.3,
} as const;

export class PrismaRouterConfigRepository implements RouterConfigRepository {
  async getSingleton(): Promise<RouterConfigRow | null> {
    const row = await getTenantDb("router config").routerConfig.findUnique({
      where: { singletonKey: 1 },
      include: { fallbackAgent: { select: { name: true } } },
    });
    if (!row) return null;

    return {
      // The four enum-shaped columns are cast, not re-validated: `CK_RouterConfigs_*`
      // already guarantees the real, live value is one of `router-config-vocabulary.ts`'s
      // own closed literals — re-checking it here would only be able to detect a database
      // written outside this app's own constraints, which the CHECK itself already forbids.
      executionMode: row.executionMode as ExecutionMode,
      routingStrategy: row.routingStrategy as RoutingStrategy,
      agentSelectionScope: row.agentSelectionScope as AgentSelectionScope,
      agentScopeListJson: row.agentScopeListJson,
      maxHops: row.maxHops,
      maxLoopIterations: row.maxLoopIterations,
      costCeilingTokens: row.costCeilingTokens,
      // `BigInt` -> `number`, per this port's own doc comment on why that's safe here.
      costCeilingMicroAed: Number(row.costCeilingMicroAed),
      conflictResolution: row.conflictResolution as ConflictResolution,
      responseMergePolicy: row.responseMergePolicy as MergePolicy,
      fallbackAgentId: row.fallbackAgentId,
      fallbackAgentName: row.fallbackAgent?.name ?? null,
      minRoutingConfidence: Number(row.minRoutingConfidence),
      updatedAt: row.updatedAt,
      activePipelineVersionId: row.activePipelineVersionId,
    };
  }

  async createDefault(input: CreateDefaultRouterConfigInput): Promise<void> {
    const db = getTenantDb("router config create default");
    await db.routerConfig.create({
      data: {
        id: newUlid(input.now),
        singletonKey: 1,
        ...SEWA_MIRRORED_DEFAULTS,
        createdAt: input.now,
      },
    });
  }

  async updateTenantConfig(input: UpdateRouterConfigInput): Promise<RouterConfigRow> {
    const db = getTenantDb("router config update");
    const existing = await db.routerConfig.findUniqueOrThrow({ where: { singletonKey: 1 } });
    const updated = await db.routerConfig.update({
      where: { id: existing.id },
      data: {
        executionMode: input.executionMode,
        routingStrategy: input.routingStrategy,
        agentSelectionScope: input.agentSelectionScope,
        agentScopeListJson: input.agentScopeListJson,
        maxHops: input.maxHops,
        maxLoopIterations: input.maxLoopIterations,
        costCeilingTokens: input.costCeilingTokens,
        // `number` -> `BigInt`, the write-side mirror of `getSingleton()`'s own
        // `BigInt` -> `number` read conversion (this port's own doc comment on why
        // that direction is safe for a per-turn micro-AED ceiling).
        costCeilingMicroAed: BigInt(input.costCeilingMicroAed),
        conflictResolution: input.conflictResolution,
        responseMergePolicy: input.responseMergePolicy,
        fallbackAgentId: input.fallbackAgentId,
        minRoutingConfidence: input.minRoutingConfidence,
        updatedAt: new Date(),
      },
      include: { fallbackAgent: { select: { name: true } } },
    });

    return {
      executionMode: updated.executionMode as ExecutionMode,
      routingStrategy: updated.routingStrategy as RoutingStrategy,
      agentSelectionScope: updated.agentSelectionScope as AgentSelectionScope,
      agentScopeListJson: updated.agentScopeListJson,
      maxHops: updated.maxHops,
      maxLoopIterations: updated.maxLoopIterations,
      costCeilingTokens: updated.costCeilingTokens,
      costCeilingMicroAed: Number(updated.costCeilingMicroAed),
      conflictResolution: updated.conflictResolution as ConflictResolution,
      responseMergePolicy: updated.responseMergePolicy as MergePolicy,
      fallbackAgentId: updated.fallbackAgentId,
      fallbackAgentName: updated.fallbackAgent?.name ?? null,
      minRoutingConfidence: Number(updated.minRoutingConfidence),
      updatedAt: updated.updatedAt,
      activePipelineVersionId: updated.activePipelineVersionId,
    };
  }

  async setActivePipelineVersion(input: {
    readonly pipelineVersionId: string | null;
    readonly now: Date;
  }): Promise<RouterConfigRow> {
    const db = getTenantDb("router config set active pipeline");
    const existing = await db.routerConfig.findUniqueOrThrow({ where: { singletonKey: 1 } });
    const updated = await db.routerConfig.update({
      where: { id: existing.id },
      data: { activePipelineVersionId: input.pipelineVersionId, updatedAt: input.now },
      include: { fallbackAgent: { select: { name: true } } },
    });

    return {
      executionMode: updated.executionMode as ExecutionMode,
      routingStrategy: updated.routingStrategy as RoutingStrategy,
      agentSelectionScope: updated.agentSelectionScope as AgentSelectionScope,
      agentScopeListJson: updated.agentScopeListJson,
      maxHops: updated.maxHops,
      maxLoopIterations: updated.maxLoopIterations,
      costCeilingTokens: updated.costCeilingTokens,
      costCeilingMicroAed: Number(updated.costCeilingMicroAed),
      conflictResolution: updated.conflictResolution as ConflictResolution,
      responseMergePolicy: updated.responseMergePolicy as MergePolicy,
      fallbackAgentId: updated.fallbackAgentId,
      fallbackAgentName: updated.fallbackAgent?.name ?? null,
      minRoutingConfidence: Number(updated.minRoutingConfidence),
      updatedAt: updated.updatedAt,
      activePipelineVersionId: updated.activePipelineVersionId,
    };
  }
}
