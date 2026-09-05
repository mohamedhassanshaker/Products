import type { TenantContext } from "@nextbot/db";
import { generateId, schema, withTenant, type TenantScopedClient } from "@nextbot/db";
import { and, eq } from "drizzle-orm";
import { AgentBlueprintNotFoundError, type AgentDefinitionArtifact, type CreateAgentBlueprintRequest } from "@nextbot/contracts";
import { serializeArtifactToYaml, parseArtifactFromYaml } from "./agent-definition-service.js";
import { createStudioDraft as insertStudioDraft, patchStudioDraft, type StudioDraftRow } from "../infrastructure/studio-draft-repository.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15) — the Blueprints
 * Gallery, **descoped to tenant-local starter templates** (spec §9.5/LLD §14
 * boundary-with-HLD note): a tenant's own admin composes and saves a working
 * Studio draft's artifact as a blueprint, reusable only within that same
 * tenant. Selecting one opens the Studio pre-populated at the Review step of a
 * working Draft, editable before save — this module stages that pre-population
 * via the SAME `studio_draft` scratch row every other Studio flow uses, never a
 * second draft mechanism.
 */

export interface AgentBlueprintRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  artifactYaml: string;
  createdByUserId: string | null;
  createdAt: Date;
}

export async function createBlueprint(ctx: TenantContext, input: CreateAgentBlueprintRequest, createdByUserId: string | null): Promise<AgentBlueprintRow> {
  const artifactYaml = serializeArtifactToYaml(input.artifact);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.agentBlueprint).values({ id, tenantId: ctx.tenantId, name: input.name, description: input.description, artifactYaml, createdByUserId });
    const [row] = await db.select().from(schema.agentBlueprint).where(eq(schema.agentBlueprint.id, id));
    if (!row) throw new Error("createBlueprint: insert did not return a row");
    return row;
  });
}

export async function listBlueprints(ctx: TenantContext): Promise<AgentBlueprintRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.agentBlueprint).where(eq(schema.agentBlueprint.tenantId, ctx.tenantId)));
}

async function requireBlueprint(ctx: TenantContext, id: string): Promise<AgentBlueprintRow> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.agentBlueprint).where(and(eq(schema.agentBlueprint.tenantId, ctx.tenantId), eq(schema.agentBlueprint.id, id)));
    return rows[0];
  });
  if (!row) throw new AgentBlueprintNotFoundError(id);
  return row;
}

export async function getBlueprint(ctx: TenantContext, id: string): Promise<AgentBlueprintRow> {
  return requireBlueprint(ctx, id);
}

/**
 * Selecting a blueprint opens the Studio "pre-populated at the Review step of a
 * working Draft, editable before save" — this creates a fresh `studio_draft`
 * scratch row whose every step-slice is pre-filled from the blueprint's own
 * artifact (parsed back via the SAME `parseArtifactFromYaml`/round-trip pair
 * the whole Studio regression guard relies on), staged all the way to step 10
 * (Review) in one call rather than requiring the admin to click through nine
 * steps of already-decided answers.
 */
export async function instantiateBlueprintAsDraft(ctx: TenantContext, blueprintId: string, agentDefinitionId: string, createdByUserId: string): Promise<StudioDraftRow> {
  const blueprint = await requireBlueprint(ctx, blueprintId);
  const artifact = parseArtifactFromYaml(blueprint.artifactYaml) as AgentDefinitionArtifact;

  const draft = await insertStudioDraft(ctx, agentDefinitionId, createdByUserId);
  return patchStudioDraft(
    ctx,
    draft.id,
    {
      purpose: { instructions: artifact.spec.instructions },
      audience: { trustLevel: artifact.spec.trustLevel, channelTypes: artifact.spec.channelTypes },
      skills: { skills: artifact.spec.skills ?? [] },
      tools: { capabilityGroups: artifact.spec.toolPolicy.capabilityGroups, maxToolCallsPerTurn: artifact.spec.toolPolicy.maxToolCallsPerTurn },
      knowledge: { knowledge: artifact.spec.knowledge },
      guardrails: { minConfidenceForAutonomy: artifact.spec.guardrails.minConfidenceForAutonomy, escalateOn: artifact.spec.guardrails.escalateOn, trustLevel: artifact.spec.trustLevel, maskingFloor: artifact.spec.maskingFloor },
      modelBudgets: { modelRoute: artifact.spec.modelRoute, maxCostUsdPerConversation: artifact.spec.budgets.maxCostUsdPerConversation, maxLatencyMsP95: artifact.spec.budgets.maxLatencyMsP95 },
      memory: artifact.spec.memory,
      evals: { includedSkillEvalCaseIds: [] },
    },
    10,
  );
}
