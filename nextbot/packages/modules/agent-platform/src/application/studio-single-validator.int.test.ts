import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import * as artifactValidator from "./artifact-validator.js";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { createDraft, submitPurposeStep, submitDraft } from "./studio-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) —
 * "the Studio's save path calls `domain/artifact-validator.ts`, the SAME
 * symbol Text and Design mode call — assert by spying on the module export,
 * not by inspection." A spy proves the exact same function OBJECT is invoked
 * by both call paths, not merely two independently-written checks that happen
 * to look equivalent today and could silently diverge tomorrow.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  vi.restoreAllMocks();
});

describe("Studio and Text/Design mode call the SAME validateAgentDefinitionArtifact export", () => {
  it("Text/Design mode's own path (createAgentDefinitionVersion) invokes the spied export", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const spy = vi.spyOn(artifactValidator, "validateAgentDefinitionArtifact");

    const definition = await createAgentDefinition(ctx, { name: "single-validator-text" });
    await createAgentDefinitionVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        artifact: {
          apiVersion: "nextbot.io/v1",
          kind: "AgentDefinition",
          metadata: { name: "single-validator-text", version: "1.0.0" },
          spec: {
            graphType: "ADK",
            modelRoute: "chat.primary",
            instructions: "You are a support agent.",
            toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
            guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
            memory: { strategy: "rolling-window", maxTurns: 20 },
            budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
          },
        },
      },
      null,
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the Studio's Review-step submit (submitDraft) invokes the IDENTICAL spied export", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const spy = vi.spyOn(artifactValidator, "validateAgentDefinitionArtifact");

    const definition = await createAgentDefinition(ctx, { name: "single-validator-studio" });
    const draft = await createDraft(ctx, definition.id, "00000000-0000-0000-0000-000000000001");
    await submitPurposeStep(ctx, draft.id, { instructions: "You are a support agent." });
    await submitDraft(ctx, draft.id, { version: "1.0.0", modelRouteKey: "chat.primary" }, "00000000-0000-0000-0000-000000000001");

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
