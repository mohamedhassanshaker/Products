/**
 * In-memory implementations of every `tools` port.
 *
 * These exist for the same reason `iam/testing/fakes.ts` does: every use case in
 * `modules/tools/application/` is exercised with no SQL Server, no Redis and no
 * live call to `apps/ai` — so the whole registry suite (skills, MCP servers, API
 * connectors, tool bindings, circuit breakers) runs inside a pre-commit hook.
 *
 * Same two rules as `iam`'s fakes, because a fake that is more permissive than
 * the real adapter tests nothing:
 *
 *  - **Ids are generated, never accepted.** Every `create*` mints its own id,
 *    matching every real Prisma adapter's contract (`newUlid`). Deterministic
 *    (`skill_fake_1`, `skill_fake_2`, ...) so assertions can name them, which the
 *    real store cannot be and must not be.
 *  - **Failures are reachable.** Every documented rejection reason
 *    (`tools.skill_in_use`, `tools.server_not_connected`, `tools.binding_not_found`,
 *    `tools.breaker_not_found`, every `McpConnectResult` shape, ...) can be driven
 *    from a test, because that is where this module's trigger-rejection-
 *    translation decisions live.
 *
 * Not a `.test.ts` file: it is the module's test support, imported by tests, and
 * subject to the same lint rules as production code.
 */

import type { ToolBindingTargetKind } from "../domain/tool-catalog.js";
import type {
  ApiConnectorRepository,
  ApiConnectorRow,
  DeleteApiConnectorResult,
  NewApiConnectorInput,
} from "../ports/api-connector-repository.js";
import type {
  CircuitBreakerConfigRow,
  CircuitBreakerEventRow,
  CircuitBreakerRepository,
} from "../ports/circuit-breaker-repository.js";
import type {
  BreakerLiveState,
  CircuitBreakerStateStore,
} from "../ports/circuit-breaker-state-store.js";
import type {
  McpConnectResult,
  McpDiscoveryClient,
  McpServerConnectionConfig,
} from "../ports/mcp-discovery-client.js";
import type {
  DeleteMcpServerResult,
  McpServerRepository,
  McpServerRow,
  McpToolRow,
  NewMcpServerInput,
} from "../ports/mcp-server-repository.js";
import type {
  DeleteSkillResult,
  NewNativeSkillInput,
  SkillRepository,
  SkillRow,
} from "../ports/skill-repository.js";
import type {
  BindToolResult,
  ToolBindingRepository,
  ToolBindingRow,
} from "../ports/tool-binding-repository.js";

function slugifyKey(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "skill"
  );
}

export class FakeSkillRepository implements SkillRepository {
  private readonly rows = new Map<string, SkillRow>();
  private readonly boundAgentVersionIds = new Map<string, readonly string[]>();
  private counter = 0;

  seed(row: SkillRow): void {
    this.rows.set(row.id, row);
  }

  /** Makes the next `softDelete(id, ...)` return `tools.skill_in_use` naming these agent versions. */
  blockDelete(id: string, boundAgentVersionIds: readonly string[]): void {
    this.boundAgentVersionIds.set(id, boundAgentVersionIds);
  }

  async list(): Promise<readonly SkillRow[]> {
    return [...this.rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<SkillRow | null> {
    return this.rows.get(id) ?? null;
  }

  async createNative(input: NewNativeSkillInput): Promise<SkillRow> {
    this.counter += 1;
    const taken = new Set([...this.rows.values()].map((row) => row.key));
    const base = slugifyKey(input.name);
    let key = base;
    for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}_${suffix}`;

    const row: SkillRow = {
      id: `skill_fake_${this.counter}`,
      key,
      name: input.name,
      description: input.description,
      category: input.category,
      invocationKind: "Native",
      apiConnectorId: null,
      mcpToolId: null,
      inputSchemaJson: input.inputSchemaJson,
      outputSchemaJson: input.outputSchemaJson,
      rateLimitPolicyId: null,
      isSystem: false,
      isAttachedByDefault: input.isAttachedByDefault,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string | null;
      readonly category?: string | null;
    },
    now: Date,
  ): Promise<void> {
    void now;
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`No such skill: "${id}".`);
    this.rows.set(id, {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
    });
  }

  async softDelete(id: string, now: Date): Promise<DeleteSkillResult> {
    void now;
    const boundAgentVersionIds = this.boundAgentVersionIds.get(id) ?? [];
    if (boundAgentVersionIds.length > 0) {
      return { ok: false, reason: "tools.skill_in_use", boundAgentVersionIds };
    }
    this.rows.delete(id);
    return { ok: true };
  }
}

export class FakeMcpServerRepository implements McpServerRepository {
  private readonly servers = new Map<string, McpServerRow>();
  private readonly tools = new Map<string, readonly McpToolRow[]>();
  private readonly boundAgentVersionIds = new Map<string, readonly string[]>();
  private counter = 0;
  private toolCounter = 0;

  seed(row: McpServerRow): void {
    this.servers.set(row.id, row);
  }

  seedTool(row: McpToolRow): void {
    const existing = this.tools.get(row.mcpServerId) ?? [];
    this.tools.set(row.mcpServerId, [...existing, row]);
  }

  /** Makes the next `softDelete(id, ...)` return `tools.server_in_use` naming these agent versions. */
  blockDelete(id: string, boundAgentVersionIds: readonly string[]): void {
    this.boundAgentVersionIds.set(id, boundAgentVersionIds);
  }

  async list(): Promise<readonly McpServerRow[]> {
    return [...this.servers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<McpServerRow | null> {
    return this.servers.get(id) ?? null;
  }

  async create(input: NewMcpServerInput): Promise<McpServerRow> {
    this.counter += 1;
    const row: McpServerRow = {
      id: `mcp_fake_${this.counter}`,
      name: input.name,
      endpoint: input.endpoint,
      transport: input.transport,
      authMode: input.authMode,
      credentialSecretRef: input.credentialSecretRef,
      connectionState: "NotConnected",
      lastDiscoveryAt: null,
      lastConnectedAt: null,
      lastError: null,
    };
    this.servers.set(row.id, row);
    return row;
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly endpoint?: string;
      readonly transport?: McpServerRow["transport"];
      readonly authMode?: McpServerRow["authMode"];
      readonly credentialSecretRef?: string | null;
    },
    now: Date,
  ): Promise<void> {
    const existing = this.servers.get(id);
    if (!existing) throw new Error(`No such MCP server: "${id}".`);
    const endpointOrAuthChanged = input.endpoint !== undefined || input.authMode !== undefined;

    this.servers.set(id, {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      ...(input.transport !== undefined ? { transport: input.transport } : {}),
      ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
      ...(input.credentialSecretRef !== undefined
        ? { credentialSecretRef: input.credentialSecretRef }
        : {}),
      ...(endpointOrAuthChanged ? { connectionState: "NotConnected" as const } : {}),
    });

    if (endpointOrAuthChanged) {
      const existingTools = this.tools.get(id) ?? [];
      this.tools.set(
        id,
        existingTools.map((tool) => (tool.removedAt !== null ? tool : { ...tool, removedAt: now })),
      );
    }
  }

  async softDelete(id: string, now: Date): Promise<DeleteMcpServerResult> {
    void now;
    const boundAgentVersionIds = this.boundAgentVersionIds.get(id) ?? [];
    if (boundAgentVersionIds.length > 0) {
      return { ok: false, reason: "tools.server_in_use", boundAgentVersionIds };
    }
    this.servers.delete(id);
    return { ok: true };
  }

  async listTools(mcpServerId: string): Promise<readonly McpToolRow[]> {
    return (this.tools.get(mcpServerId) ?? [])
      .filter((tool) => tool.removedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async recordSuccessfulDiscovery(
    mcpServerId: string,
    discovered: readonly {
      readonly name: string;
      readonly description: string | null;
      readonly inputSchemaJson: string;
    }[],
    now: Date,
  ): Promise<readonly McpToolRow[]> {
    const existing = this.tools.get(mcpServerId) ?? [];
    const byId = new Map(existing.map((tool) => [tool.id, tool] as const));
    const byName = new Map(existing.map((tool) => [tool.name, tool] as const));
    const discoveredNames = new Set(discovered.map((d) => d.name));

    for (const tool of existing) {
      if (tool.removedAt === null && !discoveredNames.has(tool.name)) {
        byId.set(tool.id, { ...tool, removedAt: now });
      }
    }

    for (const d of discovered) {
      const existingTool = byName.get(d.name);
      if (existingTool) {
        byId.set(existingTool.id, {
          ...existingTool,
          description: d.description,
          inputSchemaJson: d.inputSchemaJson,
          lastSeenAt: now,
          removedAt: null,
        });
      } else {
        this.toolCounter += 1;
        const created: McpToolRow = {
          id: `mcptool_fake_${this.toolCounter}`,
          mcpServerId,
          name: d.name,
          description: d.description,
          inputSchemaJson: d.inputSchemaJson,
          discoveredAt: now,
          lastSeenAt: now,
          removedAt: null,
        };
        byId.set(created.id, created);
      }
    }

    this.tools.set(mcpServerId, [...byId.values()]);

    const server = this.servers.get(mcpServerId);
    if (server) {
      this.servers.set(mcpServerId, {
        ...server,
        connectionState: "Connected",
        lastDiscoveryAt: now,
        lastConnectedAt: now,
        lastError: null,
      });
    }

    return this.listTools(mcpServerId);
  }

  async recordConnectionFailure(
    mcpServerId: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    void now;
    const server = this.servers.get(mcpServerId);
    if (!server) throw new Error(`No such MCP server: "${mcpServerId}".`);
    this.servers.set(mcpServerId, {
      ...server,
      connectionState: "Failed",
      lastError: errorMessage,
    });
  }
}

export class FakeApiConnectorRepository implements ApiConnectorRepository {
  private readonly rows = new Map<string, ApiConnectorRow>();
  private readonly boundAgentVersionIds = new Map<string, readonly string[]>();
  private counter = 0;

  seed(row: ApiConnectorRow): void {
    this.rows.set(row.id, row);
  }

  /** Makes the next `softDelete(id, ...)` return `tools.connector_in_use` naming these agent versions. */
  blockDelete(id: string, boundAgentVersionIds: readonly string[]): void {
    this.boundAgentVersionIds.set(id, boundAgentVersionIds);
  }

  async list(): Promise<readonly ApiConnectorRow[]> {
    return [...this.rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<ApiConnectorRow | null> {
    return this.rows.get(id) ?? null;
  }

  async create(input: NewApiConnectorInput): Promise<ApiConnectorRow> {
    this.counter += 1;
    const row: ApiConnectorRow = {
      id: `connector_fake_${this.counter}`,
      name: input.name,
      method: input.method,
      urlTemplate: input.urlTemplate,
      authMode: input.authMode,
      credentialSecretRef: input.credentialSecretRef,
      headersJson: input.headersJson,
      requestSchemaJson: input.requestSchemaJson,
      responseSchemaJson: input.responseSchemaJson,
      timeoutMs: input.timeoutMs,
      testState: "Untested",
      lastTestedAt: null,
      sampleResponseJson: null,
      rateLimitPolicyId: `policy_fake_${this.counter}`,
      projectedSkillId: `skill_fake_projected_${this.counter}`,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly method?: ApiConnectorRow["method"];
      readonly urlTemplate?: string;
      readonly authMode?: ApiConnectorRow["authMode"];
      readonly credentialSecretRef?: string | null;
      readonly headersJson?: string | null;
      readonly requestSchemaJson?: string | null;
      readonly responseSchemaJson?: string | null;
      readonly timeoutMs?: number;
    },
    now: Date,
  ): Promise<void> {
    void now;
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`No such API connector: "${id}".`);
    const requestShapeChanged =
      input.method !== undefined || input.urlTemplate !== undefined || input.authMode !== undefined;

    this.rows.set(id, {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.urlTemplate !== undefined ? { urlTemplate: input.urlTemplate } : {}),
      ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
      ...(input.credentialSecretRef !== undefined
        ? { credentialSecretRef: input.credentialSecretRef }
        : {}),
      ...(input.headersJson !== undefined ? { headersJson: input.headersJson } : {}),
      ...(input.requestSchemaJson !== undefined
        ? { requestSchemaJson: input.requestSchemaJson }
        : {}),
      ...(input.responseSchemaJson !== undefined
        ? { responseSchemaJson: input.responseSchemaJson }
        : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(requestShapeChanged ? { testState: "Untested" as const, lastTestedAt: null } : {}),
    });
  }

  async softDelete(id: string, now: Date): Promise<DeleteApiConnectorResult> {
    void now;
    const boundAgentVersionIds = this.boundAgentVersionIds.get(id) ?? [];
    if (boundAgentVersionIds.length > 0) {
      return { ok: false, reason: "tools.connector_in_use", boundAgentVersionIds };
    }
    this.rows.delete(id);
    return { ok: true };
  }

  async recordTestResult(
    id: string,
    result: { readonly ok: boolean; readonly sampleResponseJson: string | null },
    now: Date,
  ): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`No such API connector: "${id}".`);
    this.rows.set(id, {
      ...existing,
      testState: result.ok ? "Tested" : "Failed",
      lastTestedAt: now,
      sampleResponseJson: result.sampleResponseJson,
    });
  }
}

function targetColumnValue(binding: ToolBindingRow): string | null {
  if (binding.targetKind === "Skill") return binding.skillId;
  if (binding.targetKind === "McpTool") return binding.mcpToolId;
  return binding.apiConnectorId;
}

export class FakeToolBindingRepository implements ToolBindingRepository {
  private readonly bindings = new Map<string, ToolBindingRow>();
  private counter = 0;
  private nextBindRejection: "tools.server_not_connected" | "tools.target_soft_deleted" | null =
    null;

  seed(row: ToolBindingRow): void {
    this.bindings.set(row.id, row);
  }

  /** Makes the next `bind(...)` call return this rejection instead of writing anything — simulates `TR_ToolBindings_serverMustBeConnected`'s two THROW paths without a real trigger. */
  rejectNextBind(reason: "tools.server_not_connected" | "tools.target_soft_deleted"): void {
    this.nextBindRejection = reason;
  }

  async listForVersion(agentVersionId: string): Promise<readonly ToolBindingRow[]> {
    return [...this.bindings.values()].filter(
      (binding) => binding.agentVersionId === agentVersionId,
    );
  }

  async bind(input: {
    readonly agentVersionId: string;
    readonly targetKind: ToolBindingTargetKind;
    readonly targetId: string;
    readonly requiredAssurance: ToolBindingRow["requiredAssurance"];
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<BindToolResult> {
    if (this.nextBindRejection) {
      const reason = this.nextBindRejection;
      this.nextBindRejection = null;
      return { ok: false, reason };
    }

    const existing = [...this.bindings.values()].find(
      (binding) =>
        binding.agentVersionId === input.agentVersionId &&
        binding.targetKind === input.targetKind &&
        targetColumnValue(binding) === input.targetId,
    );
    if (existing) {
      const updated: ToolBindingRow = { ...existing, isEnabled: true };
      this.bindings.set(existing.id, updated);
      return { ok: true, binding: updated };
    }

    this.counter += 1;
    const row: ToolBindingRow = {
      id: `binding_fake_${this.counter}`,
      agentVersionId: input.agentVersionId,
      targetKind: input.targetKind,
      skillId: input.targetKind === "Skill" ? input.targetId : null,
      mcpToolId: input.targetKind === "McpTool" ? input.targetId : null,
      apiConnectorId: input.targetKind === "ApiConnector" ? input.targetId : null,
      isEnabled: true,
      argumentPolicyJson: null,
      requiredAssurance: input.requiredAssurance,
      rateLimitPolicyId: null,
      boundByStaffUserId: input.actorStaffUserId,
      boundAt: input.now,
    };
    this.bindings.set(row.id, row);
    return { ok: true, binding: row };
  }

  async unbind(input: {
    readonly agentVersionId: string;
    readonly targetKind: ToolBindingTargetKind;
    readonly targetId: string;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: "tools.binding_not_found" }
  > {
    const existing = [...this.bindings.values()].find(
      (binding) =>
        binding.agentVersionId === input.agentVersionId &&
        binding.targetKind === input.targetKind &&
        targetColumnValue(binding) === input.targetId,
    );
    if (!existing) return { ok: false, reason: "tools.binding_not_found" };
    this.bindings.set(existing.id, { ...existing, isEnabled: false });
    return { ok: true };
  }

  private countBy(
    kind: ToolBindingTargetKind,
    pick: (binding: ToolBindingRow) => string | null,
  ): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const binding of this.bindings.values()) {
      if (binding.targetKind !== kind || !binding.isEnabled) continue;
      const id = pick(binding);
      if (id === null) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  async countEnabledBindingsBySkill(): Promise<ReadonlyMap<string, number>> {
    return this.countBy("Skill", (binding) => binding.skillId);
  }

  async countEnabledBindingsByMcpTool(): Promise<ReadonlyMap<string, number>> {
    return this.countBy("McpTool", (binding) => binding.mcpToolId);
  }

  async countEnabledBindingsByApiConnector(): Promise<ReadonlyMap<string, number>> {
    return this.countBy("ApiConnector", (binding) => binding.apiConnectorId);
  }
}

export class FakeCircuitBreakerRepository implements CircuitBreakerRepository {
  private readonly configs = new Map<string, CircuitBreakerConfigRow>();
  private readonly events: CircuitBreakerEventRow[] = [];
  private counter = 0;

  seed(row: CircuitBreakerConfigRow): void {
    this.configs.set(row.id, row);
  }

  /** Every appended event, in order — asserted by `ResetCircuitBreaker`/`TripCircuitBreaker`'s tests. */
  get appendedEvents(): readonly CircuitBreakerEventRow[] {
    return this.events;
  }

  async list(): Promise<readonly CircuitBreakerConfigRow[]> {
    return [...this.configs.values()];
  }

  async get(id: string): Promise<CircuitBreakerConfigRow | null> {
    return this.configs.get(id) ?? null;
  }

  async update(
    id: string,
    input: {
      readonly failureThreshold?: number;
      readonly windowSeconds?: number;
      readonly cooldownSeconds?: number;
      readonly fallbackStrategy?: CircuitBreakerConfigRow["fallbackStrategy"];
      readonly cachedAnswerMaxAgeSeconds?: number | null;
      readonly serveCachedWhenDown?: boolean;
      readonly degradedModeMessage?: string;
      readonly isEnabled?: boolean;
    },
    now: Date,
  ): Promise<void> {
    void now;
    const existing = this.configs.get(id);
    if (!existing) throw new Error(`No such circuit breaker config: "${id}".`);
    this.configs.set(id, {
      ...existing,
      ...(input.failureThreshold !== undefined ? { failureThreshold: input.failureThreshold } : {}),
      ...(input.windowSeconds !== undefined ? { windowSeconds: input.windowSeconds } : {}),
      ...(input.cooldownSeconds !== undefined ? { cooldownSeconds: input.cooldownSeconds } : {}),
      ...(input.fallbackStrategy !== undefined ? { fallbackStrategy: input.fallbackStrategy } : {}),
      ...(input.cachedAnswerMaxAgeSeconds !== undefined
        ? { cachedAnswerMaxAgeSeconds: input.cachedAnswerMaxAgeSeconds }
        : {}),
      ...(input.serveCachedWhenDown !== undefined
        ? { serveCachedWhenDown: input.serveCachedWhenDown }
        : {}),
      ...(input.degradedModeMessage !== undefined
        ? { degradedModeMessage: input.degradedModeMessage }
        : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
    });
  }

  async appendEvent(input: {
    readonly circuitBreakerConfigId: string;
    readonly transition: CircuitBreakerEventRow["transition"];
    readonly reason: CircuitBreakerEventRow["reason"];
    readonly failureCount: number | null;
    readonly actorStaffUserId: string | null;
    readonly now: Date;
  }): Promise<CircuitBreakerEventRow> {
    this.counter += 1;
    const row: CircuitBreakerEventRow = {
      id: `cbevent_fake_${this.counter}`,
      circuitBreakerConfigId: input.circuitBreakerConfigId,
      transition: input.transition,
      reason: input.reason,
      failureCount: input.failureCount,
      actorStaffUserId: input.actorStaffUserId,
      occurredAt: input.now,
    };
    this.events.push(row);
    return row;
  }

  async listRecentEvents(
    circuitBreakerConfigId: string,
    limit: number,
  ): Promise<readonly CircuitBreakerEventRow[]> {
    return this.events
      .filter((event) => event.circuitBreakerConfigId === circuitBreakerConfigId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }
}

export class InMemoryCircuitBreakerStateStore implements CircuitBreakerStateStore {
  private readonly states = new Map<string, BreakerLiveState>();
  private degraded = false;

  private key(targetKind: string, ref: string): string {
    return `${targetKind}:${ref}`;
  }

  /** Seed a state directly. Omit a key entirely (do not call this) to exercise the "no key yet" -> `null` path a real Redis miss produces. */
  seedState(targetKind: string, ref: string, state: BreakerLiveState): void {
    this.states.set(this.key(targetKind, ref), state);
  }

  async getState(targetKind: string, ref: string): Promise<BreakerLiveState | null> {
    return this.states.get(this.key(targetKind, ref)) ?? null;
  }

  async setState(targetKind: string, ref: string, state: BreakerLiveState): Promise<void> {
    this.states.set(this.key(targetKind, ref), state);
  }

  async isDegraded(): Promise<boolean> {
    return this.degraded;
  }

  async setDegraded(degraded: boolean, cooldownSeconds: number): Promise<void> {
    void cooldownSeconds;
    this.degraded = degraded;
  }
}

export class FakeMcpDiscoveryClient implements McpDiscoveryClient {
  private result: McpConnectResult = {
    ok: false,
    reason: "ai_runtime_unavailable",
    detail: "FakeMcpDiscoveryClient.setResult() was never called by this test.",
  };

  /** Every call's arguments, in order — asserted by `ConnectAndDiscoverMcpServer`'s tests. */
  readonly calls: { readonly mcpServerId: string; readonly config: McpServerConnectionConfig }[] =
    [];

  setResult(result: McpConnectResult): void {
    this.result = result;
  }

  async connectAndDiscover(
    mcpServerId: string,
    config: McpServerConnectionConfig,
  ): Promise<McpConnectResult> {
    this.calls.push({ mcpServerId, config });
    return this.result;
  }
}

export function skillRowFixture(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "skill_fixture_1",
    key: "fetch_sewa_bill",
    name: "Fetch SEWA bill",
    description: null,
    category: null,
    invocationKind: "Native",
    apiConnectorId: null,
    mcpToolId: null,
    inputSchemaJson: "{}",
    outputSchemaJson: null,
    rateLimitPolicyId: null,
    isSystem: false,
    isAttachedByDefault: true,
    ...overrides,
  };
}

export function mcpServerRowFixture(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: "mcp_fixture_1",
    name: "Sharjah Services Gateway",
    endpoint: "mcp://sharjah-services.internal",
    transport: "StreamableHttp",
    authMode: "OAuth2ClientCredentials",
    credentialSecretRef: "env:MCP_SHARJAH_SERVICES_TOKEN",
    connectionState: "Connected",
    lastDiscoveryAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...overrides,
  };
}

export function mcpToolRowFixture(overrides: Partial<McpToolRow> = {}): McpToolRow {
  return {
    id: "mcptool_fixture_1",
    mcpServerId: "mcp_fixture_1",
    name: "get_bill_status",
    description: null,
    inputSchemaJson: "{}",
    discoveredAt: new Date("2026-09-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-09-01T00:00:00.000Z"),
    removedAt: null,
    ...overrides,
  };
}

export function apiConnectorRowFixture(overrides: Partial<ApiConnectorRow> = {}): ApiConnectorRow {
  return {
    id: "connector_fixture_1",
    name: "Fetch SEWA bill",
    method: "GET",
    urlTemplate: "https://api.sewa.ae/v1/bills/{account}",
    authMode: "ApiKey",
    credentialSecretRef: "env:SEWA_BILL_API_KEY",
    headersJson: null,
    requestSchemaJson: null,
    responseSchemaJson: null,
    timeoutMs: 10_000,
    testState: "Untested",
    lastTestedAt: null,
    sampleResponseJson: null,
    rateLimitPolicyId: "policy_fixture_1",
    projectedSkillId: "skill_fixture_projected_1",
    ...overrides,
  };
}

export function toolBindingRowFixture(overrides: Partial<ToolBindingRow> = {}): ToolBindingRow {
  return {
    id: "binding_fixture_1",
    agentVersionId: "agentver_fixture_1",
    targetKind: "Skill",
    skillId: "skill_fixture_1",
    mcpToolId: null,
    apiConnectorId: null,
    isEnabled: true,
    argumentPolicyJson: null,
    requiredAssurance: "Verified",
    rateLimitPolicyId: null,
    boundByStaffUserId: "usr_fixture_admin",
    boundAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function circuitBreakerConfigRowFixture(
  overrides: Partial<CircuitBreakerConfigRow> = {},
): CircuitBreakerConfigRow {
  return {
    id: "breaker_fixture_1",
    targetKind: "ApiConnector",
    targetId: "connector_fixture_1",
    targetKey: null,
    failureThreshold: 5,
    windowSeconds: 60,
    cooldownSeconds: 120,
    halfOpenProbes: 1,
    fallbackStrategy: "ApologiseOfferLiveAgent",
    cachedAnswerMaxAgeSeconds: null,
    serveCachedWhenDown: false,
    degradedModeMessage:
      "Some services are slow right now — I can still answer questions, but payments may be delayed.",
    isEnabled: true,
    ...overrides,
  };
}
