import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createAgentDefinition } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase } from "./eval-service.js";
import {
  createDraft,
  getDraft,
  deleteDraft,
  submitPurposeStep,
  submitAudienceStep,
  submitSkillsStep,
  submitToolsStep,
  submitKnowledgeStep,
  submitGuardrailsStep,
  submitModelBudgetsStep,
  submitMemoryStep,
  submitEvalsStep,
  listAvailableSkillEvalCases,
  previewDraft,
  submitDraft,
} from "./studio-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) —
 * real, Postgres-backed exercise of all nine Studio wizard steps plus Review
 * (preview + submit), including the Evals step's "copy a composed skill's own
 * eval case into the version's auto-generated suite" branch.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("Studio wizard — all nine steps + Review, real Postgres", () => {
  it("stages every step, previews, and submits — the composed artifact reflects every step's own answers", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "studio-full-flow" });
    const draft = await createDraft(ctx, definition.id, "00000000-0000-0000-0000-000000000001");

    await submitPurposeStep(ctx, draft.id, { instructions: "You are a support-triage agent." });
    await submitAudienceStep(ctx, draft.id, { trustLevel: "SemiTrusted", channelTypes: ["WebWidget", "WhatsApp"] });
    await submitSkillsStep(ctx, draft.id, { skills: [] });
    await submitToolsStep(ctx, draft.id, { capabilityGroups: ["Billing"], maxToolCallsPerTurn: 3 });
    await submitKnowledgeStep(ctx, draft.id, { knowledge: undefined });
    await submitGuardrailsStep(ctx, draft.id, { minConfidenceForAutonomy: 0.7, escalateOn: ["LowConfidence", "ToolFailure"], maskingFloor: { Transcript: "PartialMask" } });
    await submitModelBudgetsStep(ctx, draft.id, { modelRoute: "chat.fast", maxCostUsdPerConversation: "0.30", maxLatencyMsP95: 4000 });
    await submitMemoryStep(ctx, draft.id, { strategy: "rolling-window", maxTurns: 15 });

    const availableCases = await listAvailableSkillEvalCases(ctx, []);
    expect(availableCases).toEqual([]);
    await submitEvalsStep(ctx, draft.id, { includedSkillEvalCaseIds: [] });

    const staged = await getDraft(ctx, draft.id);
    expect(staged.step).toBe(10);

    const preview = await previewDraft(ctx, draft.id, "1.0.0", "ADK");
    expect(preview.artifact.spec.instructions).toBe("You are a support-triage agent.");
    expect(preview.artifact.spec.trustLevel).toBe("SemiTrusted");
    expect(preview.artifact.spec.channelTypes).toEqual(["WebWidget", "WhatsApp"]);
    expect(preview.artifact.spec.toolPolicy.capabilityGroups).toEqual(["Billing"]);
    expect(preview.artifact.spec.guardrails.minConfidenceForAutonomy).toBe(0.7);
    expect(preview.artifact.spec.maskingFloor).toEqual({ Transcript: "PartialMask" });
    expect(preview.artifact.spec.modelRoute).toBe("chat.fast");
    expect(preview.artifact.spec.memory.maxTurns).toBe(15);
    expect(preview.yaml).toContain("You are a support-triage agent.");

    const version = await submitDraft(ctx, draft.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "ADK" }, "00000000-0000-0000-0000-000000000001");
    expect(version.status).toBe("Draft");

    // The consumed draft is deleted on successful submit.
    await expect(getDraft(ctx, draft.id)).rejects.toThrow();
  });

  it("copies a checked eval case into the version's auto-generated suite and binds it (the Evals step's real write path)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const sourceSuite = await createEvalSuite(ctx, { name: "source-suite-for-studio" });
    const sourceCase = await addEvalCase(ctx, sourceSuite.id, {
      name: "existing-case",
      inputTranscript: [{ sender: "Customer", text: "hello" }],
      expectedResponsePattern: ".*",
    });

    const definition = await createAgentDefinition(ctx, { name: "studio-evals-copy" });
    const draft = await createDraft(ctx, definition.id, "00000000-0000-0000-0000-000000000001");
    await submitPurposeStep(ctx, draft.id, { instructions: "You are a support agent." });
    await submitEvalsStep(ctx, draft.id, { includedSkillEvalCaseIds: [sourceCase.id] });

    const version = await submitDraft(ctx, draft.id, { version: "1.0.0", modelRouteKey: "chat.primary" }, "00000000-0000-0000-0000-000000000001");
    expect(version.evalSuiteId).not.toBeNull();
    expect(version.evalSuiteId).not.toBe(sourceSuite.id); // a NEW suite is generated, never re-using the source.
  });

  it("deleteDraft abandons an in-progress Studio session for real", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "studio-abandon" });
    const draft = await createDraft(ctx, definition.id, "00000000-0000-0000-0000-000000000001");
    await deleteDraft(ctx, draft.id);
    await expect(getDraft(ctx, draft.id)).rejects.toThrow();
  });
});
