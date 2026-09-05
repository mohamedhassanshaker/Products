import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createAgentDefinition } from "./agent-definition-service.js";
import { createBlueprint, listBlueprints, instantiateBlueprintAsDraft } from "./blueprint-service.js";
import { getDraft } from "./studio-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15) — the Blueprints
 * Gallery, descoped to tenant-local starter templates: a saved blueprint's
 * artifact round-trips into a fresh, real Studio draft pre-populated all the
 * way to the Review step (step 10), editable before save — never a direct
 * write to a real agent version.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

const BLUEPRINT_ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "blueprint-source", version: "1.0.0" },
  spec: {
    graphType: "ADK" as const,
    modelRoute: "chat.primary",
    instructions: "You are a support-triage agent.",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: ["Billing"], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: ["LowConfidence"] },
    trustLevel: "SemiTrusted" as const,
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
};

describe("Blueprints Gallery — tenant-local starter templates (FR-AGT-15)", () => {
  it("saves a blueprint, lists it for the tenant, and instantiating it produces a real Studio draft pre-populated to Review (step 10)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const blueprint = await createBlueprint(ctx, { name: "Support Triage Starter", artifact: BLUEPRINT_ARTIFACT }, null);
    const list = await listBlueprints(ctx);
    expect(list.map((b) => b.id)).toContain(blueprint.id);

    const definition = await createAgentDefinition(ctx, { name: "target-for-blueprint" });
    const draft = await instantiateBlueprintAsDraft(ctx, blueprint.id, definition.id, "00000000-0000-0000-0000-000000000001");

    expect(draft.step).toBe(10);
    expect(draft.payload.purpose?.instructions).toBe("You are a support-triage agent.");
    expect(draft.payload.tools?.capabilityGroups).toEqual(["Billing"]);
    expect(draft.payload.audience?.trustLevel).toBe("SemiTrusted");

    // A real, independent read confirms the draft is genuinely persisted, not
    // merely returned in memory.
    const reread = await getDraft(ctx, draft.id);
    expect(reread.step).toBe(10);
  });
});
