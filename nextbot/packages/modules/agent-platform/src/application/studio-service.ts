import type { TenantContext } from "@nextbot/db";
import { resolveSkillPin, getSkillVersion } from "@nextbot/skills";
import { StudioWizardStepOutOfOrderError, type AgentDefinitionArtifact, type SubmitStudioDraftRequest } from "@nextbot/contracts";
import {
  createStudioDraft as insertStudioDraft,
  getStudioDraft,
  patchStudioDraft,
  deleteStudioDraft,
  type StudioDraftPayload,
  type StudioDraftRow,
} from "../infrastructure/studio-draft-repository.js";
import { getDefinition, createAgentDefinitionVersion, bindEvalSuite, serializeArtifactToYaml } from "./agent-definition-service.js";
import { getAgentDefinitionVersion, type AgentDefinitionVersionRow } from "../infrastructure/agent-definition-repository.js";
import { createEvalSuite, getEvalCasesByIds } from "../infrastructure/eval-repository.js";
import { addEvalCase } from "./eval-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) — the
 * Agent Design Studio's own application service. Nine steps stage a
 * `studio_draft` scratch row (`infrastructure/studio-draft-repository.ts`); the
 * Review step composes the SAME `AgentDefinitionArtifact` shape Text/Design mode
 * produce and submits through the SAME `createAgentDefinitionVersion` write path
 * — this module invents no second persistence for an agent version's real
 * content, and no second validator (both go through
 * `application/artifact-validator.ts`, see that file's own doc comment).
 */

export async function createDraft(ctx: TenantContext, agentDefinitionId: string, createdByUserId: string): Promise<StudioDraftRow> {
  // Fails closed (AgentDefinitionNotFoundError) if the definition doesn't exist
  // or belongs to another tenant — never stages a draft against nothing.
  await getDefinition(ctx, agentDefinitionId);
  return insertStudioDraft(ctx, agentDefinitionId, createdByUserId);
}

export async function getDraft(ctx: TenantContext, id: string): Promise<StudioDraftRow> {
  return getStudioDraft(ctx, id);
}

export async function deleteDraft(ctx: TenantContext, id: string): Promise<void> {
  await deleteStudioDraft(ctx, id);
}

export async function submitPurposeStep(ctx: TenantContext, id: string, input: StudioDraftPayload["purpose"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { purpose: input }, 2);
}

export async function submitAudienceStep(ctx: TenantContext, id: string, input: StudioDraftPayload["audience"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { audience: input }, 3);
}

export async function submitSkillsStep(ctx: TenantContext, id: string, input: StudioDraftPayload["skills"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { skills: input }, 4);
}

export async function submitToolsStep(ctx: TenantContext, id: string, input: StudioDraftPayload["tools"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { tools: input }, 5);
}

export async function submitKnowledgeStep(ctx: TenantContext, id: string, input: StudioDraftPayload["knowledge"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { knowledge: input }, 6);
}

export async function submitGuardrailsStep(ctx: TenantContext, id: string, input: StudioDraftPayload["guardrails"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { guardrails: input }, 7);
}

export async function submitModelBudgetsStep(ctx: TenantContext, id: string, input: StudioDraftPayload["modelBudgets"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { modelBudgets: input }, 8);
}

export async function submitMemoryStep(ctx: TenantContext, id: string, input: StudioDraftPayload["memory"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { memory: input }, 9);
}

export async function submitEvalsStep(ctx: TenantContext, id: string, input: StudioDraftPayload["evals"]): Promise<StudioDraftRow> {
  return patchStudioDraft(ctx, id, { evals: input }, 10);
}

/**
 * The Studio's "Evals" step reads every composed skill's own `skill_version.
 * eval_case_ids` (LLD's own table: "auto-generated from the composed skills'
 * eval cases, editable") so the console can render a checklist BEFORE the admin
 * decides which cases to include (`submitEvalsStep`'s `includedSkillEvalCaseIds`)
 * — this function itself makes no write.
 */
export async function listAvailableSkillEvalCases(ctx: TenantContext, skillPins: string[]) {
  const cases = [];
  for (const pin of skillPins) {
    const resolved = await resolveSkillPin(ctx, pin);
    const version = await getSkillVersion(ctx, resolved.skillVersionId);
    if (version.evalCaseIds.length === 0) continue;
    const skillCases = await getEvalCasesByIds(ctx, version.evalCaseIds);
    for (const c of skillCases) cases.push({ ...c, skillName: resolved.skillName, skillVersionId: resolved.skillVersionId });
  }
  return cases;
}

/** Renders the draft's currently-staged answers into the exact
 * `AgentDefinitionArtifact` shape the Review step's YAML preview shows — the
 * SAME object `submitDraft` below hands to `createAgentDefinitionVersion`, so
 * "what you previewed is what you saved" holds by construction (one function,
 * not two independently-maintained renderings). */
export function composeArtifactFromDraft(definitionName: string, version: string, graphType: string | undefined, payload: StudioDraftPayload): AgentDefinitionArtifact {
  if (!payload.purpose?.instructions) throw new StudioWizardStepOutOfOrderError();

  const artifact: AgentDefinitionArtifact = {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: definitionName, version },
    spec: {
      graphType: (graphType as AgentDefinitionArtifact["spec"]["graphType"]) ?? "ADK",
      modelRoute: payload.modelBudgets?.modelRoute ?? "chat.primary",
      instructions: payload.purpose.instructions,
      toolPolicy: {
        source: "agent-tool-registry",
        capabilityGroups: payload.tools?.capabilityGroups ?? [],
        maxToolCallsPerTurn: payload.tools?.maxToolCallsPerTurn ?? 5,
      },
      guardrails: {
        minConfidenceForAutonomy: payload.guardrails?.minConfidenceForAutonomy ?? 0.6,
        escalateOn: payload.guardrails?.escalateOn ?? ["LowConfidence"],
      },
      trustLevel: (payload.audience?.trustLevel ?? payload.guardrails?.trustLevel) as AgentDefinitionArtifact["spec"]["trustLevel"],
      channelTypes: payload.audience?.channelTypes as AgentDefinitionArtifact["spec"]["channelTypes"],
      maskingFloor: payload.guardrails?.maskingFloor as AgentDefinitionArtifact["spec"]["maskingFloor"],
      memory: payload.memory ?? { strategy: "rolling-window", maxTurns: 20 },
      evalSuite: `${definitionName} ${version} — Studio`,
      budgets: {
        maxCostUsdPerConversation: payload.modelBudgets?.maxCostUsdPerConversation ?? "0.50",
        maxLatencyMsP95: payload.modelBudgets?.maxLatencyMsP95 ?? 6000,
      },
      skills: payload.skills?.skills,
      knowledge: payload.knowledge?.knowledge as AgentDefinitionArtifact["spec"]["knowledge"],
    },
  };
  return artifact;
}

/**
 * Review step's own "full YAML preview" (LLD §14.5.5: "Review (full YAML
 * preview, then save as Draft)") — renders the draft's currently-staged
 * answers through the EXACT SAME `composeArtifactFromDraft` +
 * `serializeArtifactToYaml` pair `submitDraft` below uses, so the preview can
 * never drift from what actually gets saved.
 */
export async function previewDraft(ctx: TenantContext, draftId: string, version: string, graphType: string | undefined): Promise<{ artifact: AgentDefinitionArtifact; yaml: string }> {
  const draft = await getStudioDraft(ctx, draftId);
  const definition = await getDefinition(ctx, draft.agentDefinitionId);
  const artifact = composeArtifactFromDraft(definition.name, version, graphType, draft.payload);
  return { artifact, yaml: serializeArtifactToYaml(artifact) };
}

/**
 * Review step's submit — **lands the version as `Draft`, always** (LLD §14.5.5's
 * own words). No parameter here (or on `CreateAgentDefinitionVersionRequest`,
 * which this function ultimately calls) can request any other status — a
 * structural guarantee `studio-lands-in-draft.test.ts` asserts, not a runtime
 * check this function would need to enforce itself. Auto-generates an eval
 * suite from the composed skills' eval cases the admin left checked
 * (`payload.evals.includedSkillEvalCaseIds`), binds it, and deletes the
 * consumed draft — mirroring the MCP wizard's own "materialise, then delete the
 * draft" convention (`submitEnrol`, `@nextbot/mcp-registry`).
 */
export async function submitDraft(ctx: TenantContext, draftId: string, input: SubmitStudioDraftRequest, createdByUserId: string): Promise<AgentDefinitionVersionRow> {
  const draft = await getStudioDraft(ctx, draftId);
  const definition = await getDefinition(ctx, draft.agentDefinitionId);
  const artifact = composeArtifactFromDraft(definition.name, input.version, input.graphType, draft.payload);

  const version = await createAgentDefinitionVersion(
    ctx,
    draft.agentDefinitionId,
    { version: input.version, graphType: input.graphType, modelRouteKey: input.modelRouteKey, artifact },
    createdByUserId,
  );

  const includedCaseIds = draft.payload.evals?.includedSkillEvalCaseIds ?? [];
  let boundEvalSuite = false;
  if (includedCaseIds.length > 0) {
    const sourceCases = await getEvalCasesByIds(ctx, includedCaseIds);
    if (sourceCases.length > 0) {
      const suite = await createEvalSuite(ctx, { name: artifact.spec.evalSuite! });
      for (const sourceCase of sourceCases) {
        await addEvalCase(ctx, suite.id, {
          name: sourceCase.name,
          inputTranscript: sourceCase.inputTranscript,
          expectedToolCalls: sourceCase.expectedToolCalls ?? undefined,
          expectedResponsePattern: sourceCase.expectedResponsePattern ?? undefined,
          weight: sourceCase.weight,
          rubric: sourceCase.rubric ?? undefined,
          judgeRouteVersionId: sourceCase.judgeRouteVersionId ?? undefined,
          source: "SkillDerived",
          sourceRef: sourceCase.id,
          skillVersionId: sourceCase.skillVersionId ?? undefined,
        });
      }
      await bindEvalSuite(ctx, version.id, suite.id);
      boundEvalSuite = true;
    }
  }

  await deleteStudioDraft(ctx, draftId);
  // `version` was captured BEFORE `bindEvalSuite` above (if it ran) — re-fetch
  // so the returned row's `evalSuiteId` reflects reality, never a stale
  // pre-bind snapshot a caller might reasonably build UI off of.
  return boundEvalSuite ? getAgentDefinitionVersion(ctx, version.id) : version;
}
