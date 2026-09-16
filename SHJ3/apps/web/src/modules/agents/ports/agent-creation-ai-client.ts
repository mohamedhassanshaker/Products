/**
 * The `/agents` registry's "Create with AI" entry point's propose call —
 * `POST /v1/agents/creation-proposals` (`apps/ai`'s `agent_authoring_router.py`), mirroring
 * `modules/flows/ports/flow-edit-ai-client.ts`'s "web holds no vendor driver, calls the AI
 * service's HTTP API" pattern exactly.
 *
 * `apps/ai` has no write access to `Agents`/`AgentVersions`/any binding table and no
 * authoring-shaped read of them either, so the caller sends the tenant's real, existing
 * catalogs (skills, MCP tools, API connectors, guardrail policy keys, whether a knowledge
 * collection exists) in the request body. Nothing about this call writes anything: it
 * returns a proposed plan for a human to review — no field is ever applied without an
 * explicit staff approval, which happens through `applyAgentCreationPlanAction`, never
 * through this port.
 *
 * This plan's only flow-shaped field is `flowInstruction` — a plain-language sentence, not a
 * node/edge graph. See `agent_creation_plan.py`'s own doc comment (apps/ai) for why flow
 * generation is deliberately left to the existing, separate flow-editing AI call.
 */

export interface SkillCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface McpToolCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly serverName: string;
}

export interface ApiConnectorCatalogEntry {
  readonly id: string;
  readonly name: string;
}

export interface GuardrailPolicyCatalogEntry {
  readonly policyKey: string;
  readonly title: string;
  readonly detail: string;
}

export interface ProposeAgentCreationInput {
  readonly businessDescription: string;
  readonly skills: readonly SkillCatalogEntry[];
  readonly mcpTools: readonly McpToolCatalogEntry[];
  readonly apiConnectors: readonly ApiConnectorCatalogEntry[];
  readonly guardrailPolicies: readonly GuardrailPolicyCatalogEntry[];
  readonly knowledgeCollectionExists: boolean;
  readonly model?: string;
  readonly fallbackModel?: string | null;
}

export interface GuardrailOverrideProposal {
  readonly policyKey: string;
  readonly mode: "Value" | "Disabled";
  readonly valueJson: string | null;
  readonly reason: string;
}

export interface ToolBindingProposal {
  readonly targetKind: "Skill" | "McpTool" | "ApiConnector";
  readonly targetId: string;
  readonly requiredAssurance: "Anonymous" | "Verified" | "VerifiedPlusOtp" | "VerifiedPlusDocument";
}

export interface AgentCreationPlan {
  readonly planSummary: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly tone: "Helpful" | "Formal" | "Concise";
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly temperature: number;
  readonly channelKeys: readonly string[];
  readonly guardrailOverrides: readonly GuardrailOverrideProposal[];
  readonly toolBindings: readonly ToolBindingProposal[];
  readonly enableKnowledge: boolean;
  readonly flowInstruction: string;
  readonly warnings: readonly string[];
  readonly usedFallbackModel: boolean;
}

export interface AgentCreationAiClient {
  proposeCreation(input: ProposeAgentCreationInput): Promise<AgentCreationPlan>;
}
