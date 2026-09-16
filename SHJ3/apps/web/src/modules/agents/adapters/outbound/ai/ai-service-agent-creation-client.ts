/**
 * The real `AgentCreationAiClient` adapter — calls `apps/ai`'s
 * `POST /v1/agents/creation-proposals` (`agent_authoring_router.py`) via
 * `createTenantScopedAiClient()`, following the same "web holds no vendor driver" rule as
 * `ai-service-flow-edit-client.ts`.
 *
 * The response is AI-generated JSON crossing a service boundary, so it is shape-checked here
 * rather than blind-cast — mirroring `ai-service-flow-edit-client.ts`'s own precedent — even
 * though `apps/ai`'s own `parse_agent_creation_plan` already validated it once; a second,
 * independent check at the boundary this codebase actually trusts is cheap and catches a
 * contract drift between the two sides, not just a malformed model reply.
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
import type {
  AgentCreationAiClient,
  AgentCreationPlan,
  GuardrailOverrideProposal,
  ProposeAgentCreationInput,
  ToolBindingProposal,
} from "../../../ports/agent-creation-ai-client.js";

const TONES = ["Helpful", "Formal", "Concise"] as const;
const GUARDRAIL_MODES = ["Value", "Disabled"] as const;
const TOOL_TARGET_KINDS = ["Skill", "McpTool", "ApiConnector"] as const;
const ASSURANCE_LEVELS = [
  "Anonymous",
  "Verified",
  "VerifiedPlusOtp",
  "VerifiedPlusDocument",
] as const;

interface RawGuardrailOverride {
  readonly policyKey?: unknown;
  readonly mode?: unknown;
  readonly valueJson?: unknown;
  readonly reason?: unknown;
}

interface RawToolBinding {
  readonly targetKind?: unknown;
  readonly targetId?: unknown;
  readonly requiredAssurance?: unknown;
}

interface RawResponse {
  readonly planSummary?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly systemPrompt?: unknown;
  readonly tone?: unknown;
  readonly primaryModel?: unknown;
  readonly fallbackModel?: unknown;
  readonly temperature?: unknown;
  readonly channelKeys?: unknown;
  readonly guardrailOverrides?: unknown;
  readonly toolBindings?: unknown;
  readonly enableKnowledge?: unknown;
  readonly flowInstruction?: unknown;
  readonly warnings?: unknown;
  readonly usedFallbackModel?: unknown;
}

function parseGuardrailOverride(raw: RawGuardrailOverride): GuardrailOverrideProposal | null {
  if (
    typeof raw.policyKey !== "string" ||
    typeof raw.mode !== "string" ||
    !(GUARDRAIL_MODES as readonly string[]).includes(raw.mode) ||
    typeof raw.reason !== "string" ||
    (raw.valueJson !== null && typeof raw.valueJson !== "string")
  ) {
    return null;
  }
  return {
    policyKey: raw.policyKey,
    mode: raw.mode as GuardrailOverrideProposal["mode"],
    valueJson: raw.valueJson,
    reason: raw.reason,
  };
}

function parseToolBinding(raw: RawToolBinding): ToolBindingProposal | null {
  if (
    typeof raw.targetKind !== "string" ||
    !(TOOL_TARGET_KINDS as readonly string[]).includes(raw.targetKind) ||
    typeof raw.targetId !== "string" ||
    typeof raw.requiredAssurance !== "string" ||
    !(ASSURANCE_LEVELS as readonly string[]).includes(raw.requiredAssurance)
  ) {
    return null;
  }
  return {
    targetKind: raw.targetKind as ToolBindingProposal["targetKind"],
    targetId: raw.targetId,
    requiredAssurance: raw.requiredAssurance as ToolBindingProposal["requiredAssurance"],
  };
}

/** Returns `null` on any shape violation — this adapter drops a malformed plan to an unusable one rather than let a bad boundary shape reach the review screen as a crash. */
function parseResponse(body: unknown): AgentCreationPlan | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as RawResponse;

  if (
    typeof raw.planSummary !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.description !== "string" ||
    typeof raw.systemPrompt !== "string" ||
    typeof raw.tone !== "string" ||
    !(TONES as readonly string[]).includes(raw.tone) ||
    typeof raw.primaryModel !== "string" ||
    (raw.fallbackModel !== null && typeof raw.fallbackModel !== "string") ||
    typeof raw.temperature !== "number" ||
    !Array.isArray(raw.channelKeys) ||
    !Array.isArray(raw.guardrailOverrides) ||
    !Array.isArray(raw.toolBindings) ||
    typeof raw.enableKnowledge !== "boolean" ||
    typeof raw.flowInstruction !== "string" ||
    !Array.isArray(raw.warnings) ||
    typeof raw.usedFallbackModel !== "boolean"
  ) {
    return null;
  }

  const channelKeys: string[] = [];
  for (const key of raw.channelKeys) {
    if (typeof key !== "string") return null;
    channelKeys.push(key);
  }

  const guardrailOverrides: GuardrailOverrideProposal[] = [];
  for (const rawOverride of raw.guardrailOverrides as readonly RawGuardrailOverride[]) {
    const override = parseGuardrailOverride(rawOverride);
    if (override === null) return null;
    guardrailOverrides.push(override);
  }

  const toolBindings: ToolBindingProposal[] = [];
  for (const rawBinding of raw.toolBindings as readonly RawToolBinding[]) {
    const binding = parseToolBinding(rawBinding);
    if (binding === null) return null;
    toolBindings.push(binding);
  }

  const warnings: string[] = [];
  for (const warning of raw.warnings) {
    if (typeof warning !== "string") return null;
    warnings.push(warning);
  }

  return {
    planSummary: raw.planSummary,
    name: raw.name,
    description: raw.description,
    systemPrompt: raw.systemPrompt,
    tone: raw.tone as AgentCreationPlan["tone"],
    primaryModel: raw.primaryModel,
    fallbackModel: raw.fallbackModel,
    temperature: raw.temperature,
    channelKeys,
    guardrailOverrides,
    toolBindings,
    enableKnowledge: raw.enableKnowledge,
    flowInstruction: raw.flowInstruction,
    warnings,
    usedFallbackModel: raw.usedFallbackModel,
  };
}

export class AiServiceAgentCreationClient implements AgentCreationAiClient {
  async proposeCreation(input: ProposeAgentCreationInput): Promise<AgentCreationPlan> {
    const client = createTenantScopedAiClient();
    const response = await client.post<unknown>("/agents/creation-proposals", { ...input });
    const parsed = parseResponse(response);
    if (parsed === null) {
      throw new Error(
        "The AI service responded, but not with the documented agent-creation-proposal shape.",
      );
    }
    return parsed;
  }
}
