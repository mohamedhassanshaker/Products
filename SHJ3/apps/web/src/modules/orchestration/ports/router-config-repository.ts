import type {
  AgentSelectionScope,
  ConflictResolution,
  ExecutionMode,
  MergePolicy,
  RoutingStrategy,
} from "../domain/router-config-vocabulary.js";

/**
 * The real `RouterConfigs` singleton (`UQ_RouterConfigs_singleton`, `singletonKey = 1`) —
 * the tenant-wide configuration `ProcessTurn.execute()` reads fresh every turn
 * (`process_turn.py`'s own `router_config = await self._config.get_router_config()`).
 *
 * `costCeilingMicroAed` is a real `BigInt` column (money as an exact integer, never a
 * float — the schema's own doc comment) narrowed to `number` at this port boundary via
 * `Number(...)`, the same convention `evaluation`/`knowledge`'s own Prisma adapters already
 * use for their `Decimal` columns — safe here because a per-turn micro-AED cost ceiling is
 * nowhere near `Number.MAX_SAFE_INTEGER`.
 */
export interface RouterConfigRow {
  readonly executionMode: ExecutionMode;
  readonly routingStrategy: RoutingStrategy;
  readonly agentSelectionScope: AgentSelectionScope;
  readonly agentScopeListJson: string | null;
  readonly maxHops: number;
  readonly maxLoopIterations: number;
  readonly costCeilingTokens: number;
  readonly costCeilingMicroAed: number;
  readonly conflictResolution: ConflictResolution;
  readonly responseMergePolicy: MergePolicy;
  readonly fallbackAgentId: string | null;
  readonly fallbackAgentName: string | null;
  readonly minRoutingConfidence: number;
  readonly updatedAt: Date;
  /** Supersedes `executionMode`/`agentSelectionScope`/`agentScopeListJson` when set —
   *  `execution-mode-panel.tsx`'s own coexistence rule. `null` for a tenant that has never
   *  activated a pipeline (every tenant today). Written only via `setActivePipelineVersion`
   *  below, never by `updateTenantConfig` — activating a pipeline is a distinct, audited act
   *  (a `PipelineVersionHistoryEntry` of kind `Activated`), not an ordinary config edit. */
  readonly activePipelineVersionId: string | null;
}

export interface CreateDefaultRouterConfigInput {
  readonly now: Date;
}

/**
 * Every `RouterConfigRow` field an admin can edit, except `fallbackAgentName` — that one
 * stays server-derived from the `fallbackAgentId` join on read, never a caller-supplied
 * value (a stale/wrong name written by a client would drift from the real agent record).
 */
export interface UpdateRouterConfigInput {
  readonly executionMode: ExecutionMode;
  readonly routingStrategy: RoutingStrategy;
  readonly agentSelectionScope: AgentSelectionScope;
  readonly agentScopeListJson: string | null;
  readonly maxHops: number;
  readonly maxLoopIterations: number;
  readonly costCeilingTokens: number;
  readonly costCeilingMicroAed: number;
  readonly conflictResolution: ConflictResolution;
  readonly responseMergePolicy: MergePolicy;
  readonly fallbackAgentId: string | null;
  readonly minRoutingConfidence: number;
}

export interface RouterConfigRepository {
  /** `null` when a tenant's provisioning never seeded this singleton — see
   *  `ProvisionDefaultRouterConfigForTenant`'s own doc comment for why that used to be
   *  possible for a real, `Active` tenant, and is now closed by real provisioning logic
   *  rather than an unenforced assumption. */
  getSingleton(): Promise<RouterConfigRow | null>;
  /**
   * Insert the tenant's `RouterConfigs` singleton with real, sane defaults — mirrors
   * `sewa`'s own real, persisted row exactly (`scripts/seed-agent-runtime-demo-data.ts`'s
   * seeded values), not `apps/ai`'s separate in-memory fallback default (see
   * `ProvisionDefaultRouterConfigForTenant`'s own doc comment for why the two are not the
   * same and which one this mirrors). Callers must check `getSingleton()` first and only
   * call this when it returned `null` — `UQ_RouterConfigs_singleton` /
   * `CK_RouterConfigs_singleton` are the real backstop, mirroring every other
   * `createDefault`-shaped method in this codebase (e.g. `ChannelRepository.createDefault`).
   */
  createDefault(input: CreateDefaultRouterConfigInput): Promise<void>;
  /**
   * Replace every editable field of the tenant's `RouterConfigs` singleton in one write.
   * `UpdateRouterConfig` (the application-layer use case) is the one place that validates
   * the real `CK_RouterConfigs_*` ranges/pairings before calling this — this method trusts
   * its input and lets the database's own CHECK constraints be the final backstop, exactly
   * like `PrismaFlowAssistantConfigRepository.updateTenantConfig`'s identical division of
   * labour. Throws if the singleton row does not exist yet — callers must
   * `getSingleton()`/`createDefault()` first, same precondition `createDefault` itself
   * documents.
   */
  updateTenantConfig(input: UpdateRouterConfigInput): Promise<RouterConfigRow>;

  /** Sets or clears (`null`) the tenant's active pipeline pointer. The caller (`SetActive
   *  PipelineVersion`, the application-layer use case) is responsible for checking the
   *  target version is genuinely `Published` before calling this — this method trusts its
   *  input and lets `TR_RouterConfigs_activePipelinePublished` be the final backstop, the
   *  same division of labour `updateTenantConfig`'s own doc comment describes. */
  setActivePipelineVersion(input: {
    readonly pipelineVersionId: string | null;
    readonly now: Date;
  }): Promise<RouterConfigRow>;
}
