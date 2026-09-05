import { generateId, schema, withTenant, type TenantContext } from "@nextbot/db";
import { handleCreateDefinition, handleCreateVersion } from "@nextbot/agent-platform";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import type { TeamArtifact } from "@nextbot/contracts";

/**
 * **TEST-ONLY** fixtures for this module's integration suites. Deliberately NOT
 * exported from `src/index.ts` — nothing in production may import it (the same
 * convention `@nextbot/db/testing` uses for `createFixtureTenant`).
 *
 * Everything here builds REAL rows through the owning modules' own public APIs
 * (`agent-platform`'s version writer, `model-gateway`'s route writer) rather than
 * hand-inserting, so a fixture can never drift into a shape the real writers would
 * never produce.
 */

const SYSTEM_USER = "11111111-1111-1111-1111-111111111111";

/** A minimal, valid agent-definition artifact. `trustLevel` is the field FR-ORC-05's
 * receiver-keyed re-masking reads (`getVersionTrustLevel`). */
export function agentArtifact(name: string, trustLevel?: "Trusted" | "SemiTrusted" | "Untrusted", capabilityGroups: string[] = []) {
  return {
    apiVersion: "nextbot.io/v1" as const,
    kind: "AgentDefinition" as const,
    metadata: { name, version: "1.0.0" },
    spec: {
      graphType: "CustomFSM" as const,
      modelRoute: "chat.primary",
      instructions: "hi",
      toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups, maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
      ...(trustLevel ? { trustLevel } : {}),
    },
  };
}

/** Creates a real `agent_definition` + `agent_definition_version` pair. */
export async function createFixtureAgentVersion(
  ctx: TenantContext,
  name: string,
  options: { trustLevel?: "Trusted" | "SemiTrusted" | "Untrusted"; capabilityGroups?: string[] } = {},
): Promise<{ definitionId: string; versionId: string; pin: string }> {
  const definition = await handleCreateDefinition(ctx, { name });
  const version = await handleCreateVersion(
    ctx,
    definition.id,
    {
      version: "1.0.0",
      modelRouteKey: "chat.primary",
      graphType: "CustomFSM",
      artifact: agentArtifact(name, options.trustLevel, options.capabilityGroups ?? []),
    },
    SYSTEM_USER,
  );
  return { definitionId: definition.id, versionId: version.id, pin: `${name}@1.0.0` };
}

/**
 * Creates a real, published model route + version. `name`/`role` default to
 * `chat.router` so the fixture satisfies FR-ORC-03's router-class supervisor rule;
 * pass something else to build the NEGATIVE case a
 * `TEAM_SUPERVISOR_ROUTE_EXPENSIVE` test needs.
 */
export async function createFixtureRoute(
  ctx: TenantContext,
  baseUrl: string,
  options: { name?: string; role?: "chat.primary" | "chat.router" | "custom" } = {},
): Promise<{ routeId: string; routeVersionId: string; name: string }> {
  const provider = await createProviderRegistration(ctx, {
    type: "openai-compatible",
    name: `Provider ${generateId().slice(0, 8)}`,
    baseUrl,
    region: ctx.region,
    retainsPrompts: false,
    trainsOnData: false,
  });
  const entry = await declareCatalogEntry(ctx, {
    providerId: provider.id,
    modelId: "router-test-model",
    displayName: "Router Test Model",
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: {
      toolCalling: false,
      vision: false,
      streaming: false,
      structuredOutput: true,
      extendedThinking: false,
      promptCaching: false,
      jsonMode: true,
    },
    tokenizer: "cl100k_base",
    priceIn: 0.0000005,
    priceOut: 0.0000015,
  });
  const name = options.name ?? "chat.router";
  const route = await createRoute(ctx, { name, ...(options.role ? { role: options.role } : {}) });
  const version = await createRouteVersion(
    ctx,
    route.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: {
        strategy: "FixedPriority",
        failoverOn: ["429", "5xx", "timeout"],
        retry: { maxPerHop: 1, backoff: "exponential" },
        totalTimeoutMs: 30000,
        cacheMode: "Off",
        onBudgetBreach: "Fail",
        allowOutOfRegionFailover: false,
      },
    },
    true,
  );
  return { routeId: route.id, routeVersionId: version.id, name };
}

/** A complete, valid team artifact with the given members. Limits are deliberately
 * generous by default so a test that is NOT about budgets never trips one
 * accidentally; every budget test overrides them explicitly. */
export function teamArtifact(
  name: string,
  supervisorPin: string,
  routeName: string,
  members: TeamArtifact["members"],
  overrides: Partial<Pick<TeamArtifact, "limits" | "scope">> = {},
): TeamArtifact {
  return {
    kind: "team",
    name,
    version: 1,
    supervisor: { agent: supervisorPin, route: routeName },
    limits: overrides.limits ?? {
      maxDepth: 4,
      maxFanOut: 8,
      maxDelegations: 12,
      runBudget: { usd: 100, seconds: 600 },
      thrashWindow: { repeats: 2, similarityThreshold: 0.9 },
    },
    failureMode: "Escalate",
    ...(overrides.scope ? { scope: overrides.scope } : {}),
    members,
  };
}

/** A real `conversation` row (plus the `channel` it needs), created via raw schema
 * access to avoid pulling `@nextbot/conversations` into this module's non-test
 * dependency surface. Nothing about a conversation's own invariants is under test
 * here — it exists purely so an escalation/approval has something to attach to. */
export async function createFixtureConversation(ctx: TenantContext): Promise<string> {
  return withTenant(ctx, async (db) => {
    const channelId = generateId();
    // `generateId()` is a UUIDv7 (time-ordered), so two channels created in the same
    // millisecond share an 8-char prefix and would collide on
    // `channel_tenant_env_name_key`. Mixing in a random suffix makes the name
    // collision-resistant regardless of timing — the same fix `createFixtureTenant`
    // itself already documents for its own slug.
    const suffix = `${channelId.slice(0, 8)}${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(schema.channel).values({
      id: channelId,
      tenantId: ctx.tenantId,
      type: "WebWidget",
      name: `Widget ${suffix}`,
      environment: "Sandbox",
      config: {},
      publicKey: `pk_${channelId}`,
    });
    const conversationId = generateId();
    await db.insert(schema.conversation).values({
      id: conversationId,
      tenantId: ctx.tenantId,
      channelId,
      language: "en",
    });
    return conversationId;
  });
}
