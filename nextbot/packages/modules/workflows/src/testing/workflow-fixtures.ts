import { generateId, type TenantContext } from "@nextbot/db";
import { handleCreateDefinition, handleCreateVersion } from "@nextbot/agent-platform";
import { createSkill } from "@nextbot/skills";
import { createConnector } from "@nextbot/connectors";
import { upsertToolFromDiscovery } from "@nextbot/tool-registry";
import { createServerWithApprovedVersion } from "@nextbot/mcp-registry";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { createAgentQueue } from "@nextbot/escalations";
import type { SkillArtifact, WorkflowGraph } from "@nextbot/contracts";

/**
 * **TEST-ONLY** fixtures for this module's integration suites (`graph-validator.
 * int.test.ts`, `workflow-service.int.test.ts`). Deliberately NOT exported from
 * `src/index.ts` — nothing in production may import it, the same convention
 * `@nextbot/db/testing`/`@nextbot/teams`' own `testing/team-fixtures.ts` use.
 *
 * Everything below builds REAL rows through the owning module's own public API
 * (never hand-inserted), so a fixture can never drift into a shape the real
 * writer would never produce.
 */

const SYSTEM_USER = "00000000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// Agent / Skill (pinned by AgentNode / SkillNode)
// ---------------------------------------------------------------------------

export async function createFixtureAgentVersion(ctx: TenantContext, name: string): Promise<{ definitionId: string; versionId: string }> {
  const definition = await handleCreateDefinition(ctx, { name });
  const version = await handleCreateVersion(
    ctx,
    definition.id,
    {
      version: "1.0.0",
      modelRouteKey: "chat.primary",
      graphType: "CustomFSM",
      artifact: {
        apiVersion: "nextbot.io/v1" as const,
        kind: "AgentDefinition" as const,
        metadata: { name, version: "1.0.0" },
        spec: {
          graphType: "CustomFSM" as const,
          modelRoute: "chat.primary",
          instructions: "hi",
          toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
          guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
          memory: { strategy: "rolling-window", maxTurns: 20 },
          budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
        },
      },
    },
    SYSTEM_USER,
  );
  return { definitionId: definition.id, versionId: version.id };
}

function skillArtifact(name: string, overrides: Partial<SkillArtifact> = {}): SkillArtifact {
  return {
    kind: "skill",
    name,
    version: 1,
    trigger: "the customer asks a question this skill handles",
    scope: { capabilityGroups: [], tools: [], knowledge: [] },
    instructions: "Answer helpfully.",
    successCriteria: "the customer's question is answered",
    escalateWhen: [],
    evalCases: [],
    ...overrides,
  };
}

export async function createFixtureSkillVersion(ctx: TenantContext, name: string): Promise<string> {
  const { version } = await createSkill(ctx, { name, artifact: skillArtifact(name) }, SYSTEM_USER);
  return version.id;
}

// ---------------------------------------------------------------------------
// Tool (pinned by ToolCallNode.toolId)
// ---------------------------------------------------------------------------

export async function createFixtureTool(ctx: TenantContext, name: string, rwClass: "Read" | "Write" = "Read"): Promise<string> {
  const connector = await createConnector(ctx, {
    name: `connector_${name}`,
    backendType: "Custom",
    transport: "StreamableHTTP",
    endpointUrl: `https://${name}.example.com/mcp`,
    authMethod: "None",
    environment: "Sandbox",
  });
  const { toolId } = await upsertToolFromDiscovery(ctx, {
    connectorId: connector.id,
    name,
    descriptionSource: `Fixture tool ${name}`,
    rwClass,
    approvalTier: rwClass === "Write" ? "Tier2" : "Tier1",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  });
  return toolId;
}

// ---------------------------------------------------------------------------
// MCP server version (pinned by ToolCallNode.mcpServerVersionId, FR-MCP-21)
// ---------------------------------------------------------------------------

export async function createFixtureMcpServerVersion(ctx: TenantContext, name: string): Promise<string> {
  const { serverVersionId } = await createServerWithApprovedVersion(ctx, {
    name,
    endpointUrl: `https://${name}.example.com/mcp`,
    items: [{ kind: "Tool", name: "op", descriptionSource: "fixture op", schemaJson: { type: "object" } }],
    createdByUserId: SYSTEM_USER,
  });
  return serverVersionId;
}

// ---------------------------------------------------------------------------
// Model route (pinned by RouterNode.classifierRouteVersionId)
// ---------------------------------------------------------------------------

export async function createFixtureRoute(ctx: TenantContext, name: string, role?: "chat.primary" | "chat.router" | "custom"): Promise<string> {
  const provider = await createProviderRegistration(ctx, {
    type: "openai-compatible",
    name: `Provider ${generateId().slice(0, 8)}`,
    baseUrl: "https://api.example.com/v1",
    region: ctx.region,
    retainsPrompts: false,
    trainsOnData: false,
  });
  const entry = await declareCatalogEntry(ctx, {
    providerId: provider.id,
    modelId: "fixture-model",
    displayName: "Fixture Model",
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: { toolCalling: false, vision: false, streaming: false, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
    priceIn: 0.0000005,
    priceOut: 0.0000015,
  });
  const route = await createRoute(ctx, { name, ...(role ? { role } : {}) });
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
  return version.id;
}

// ---------------------------------------------------------------------------
// Escalation queue (pinned by HumanTaskNode.escalationQueueId)
// ---------------------------------------------------------------------------

export async function createFixtureAgentQueue(ctx: TenantContext, name: string): Promise<string> {
  const queue = await createAgentQueue(ctx, { name });
  return queue.id;
}

// ---------------------------------------------------------------------------
// Workflow graph builders
// ---------------------------------------------------------------------------

const DEFAULT_RUN_LIMITS = { maxSteps: 50, maxCostUsd: 5, maxWallClockSeconds: 300, maxLoopIterations: 20, maxParallelBranches: 4, maxSubWorkflowDepth: 4 };

/** The minimum valid graph: a Trigger followed directly by an End — satisfies V1
 * (exactly one Trigger), V2 (every edge resolves), and V3 (the only path
 * terminates). Every rule-specific test starts from this and adds exactly the
 * node(s) needed to exercise its own rule. */
export function minimalWorkflowArtifact(name: string, overrides: Partial<WorkflowGraph["spec"]> = {}): WorkflowGraph {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "Workflow",
    metadata: { name, version: 1 },
    spec: {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
      runLimits: DEFAULT_RUN_LIMITS,
      ...overrides,
    },
  };
}
