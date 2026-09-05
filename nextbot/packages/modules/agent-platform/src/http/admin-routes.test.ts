import { describe, expect, it, vi } from "vitest";

/**
 * Target Architecture Blueprint Phase 12 (BL-43/44) — `http/admin-routes.ts` is
 * a plain delegation layer (LLD §2.2's "http/ layer... plain functions"); this
 * package had no direct unit test for it before this dispatch (every prior
 * handler was exercised only indirectly, via `apps/web`'s own route tests,
 * which mock this whole package). This file covers exactly the NEW handlers
 * this dispatch added (Studio wizard, Blueprints Gallery, eval harvesting) —
 * proving each one forwards its arguments to the correct application-layer
 * function, since even a one-line delegation can have a wrong argument order.
 */
vi.mock("../application/studio-service.js", () => ({
  createDraft: vi.fn(async () => ({ id: "draft-1" })),
  getDraft: vi.fn(async () => ({ id: "draft-1" })),
  deleteDraft: vi.fn(async () => undefined),
  submitPurposeStep: vi.fn(async () => ({ id: "draft-1", step: 2 })),
  submitAudienceStep: vi.fn(async () => ({ id: "draft-1", step: 3 })),
  submitSkillsStep: vi.fn(async () => ({ id: "draft-1", step: 4 })),
  submitToolsStep: vi.fn(async () => ({ id: "draft-1", step: 5 })),
  submitKnowledgeStep: vi.fn(async () => ({ id: "draft-1", step: 6 })),
  submitGuardrailsStep: vi.fn(async () => ({ id: "draft-1", step: 7 })),
  submitModelBudgetsStep: vi.fn(async () => ({ id: "draft-1", step: 8 })),
  submitMemoryStep: vi.fn(async () => ({ id: "draft-1", step: 9 })),
  submitEvalsStep: vi.fn(async () => ({ id: "draft-1", step: 10 })),
  listAvailableSkillEvalCases: vi.fn(async () => []),
  submitDraft: vi.fn(async () => ({ id: "version-1", status: "Draft" })),
  previewDraft: vi.fn(async () => ({ artifact: {}, yaml: "yaml" })),
}));
vi.mock("../application/blueprint-service.js", () => ({
  createBlueprint: vi.fn(async () => ({ id: "blueprint-1" })),
  listBlueprints: vi.fn(async () => []),
  getBlueprint: vi.fn(async () => ({ id: "blueprint-1" })),
  instantiateBlueprintAsDraft: vi.fn(async () => ({ id: "draft-2" })),
}));
vi.mock("../application/harvesting-service.js", () => ({
  harvestEvalCase: vi.fn(async () => ({ id: "case-1" })),
}));

const ctx = { tenantId: "11111111-1111-1111-1111-111111111111", region: "us" } as never;

describe("http/admin-routes.ts — Agent Design Studio + Blueprints + harvesting handlers (Phase 12)", () => {
  // A generous timeout: this is the first test in the file to import
  // `admin-routes.js`, which transitively pulls in its full, real (unmocked)
  // dependency graph (git-oauth, model-gateway, promote-version-service, etc.)
  // for module transform/resolution — genuinely slow on a cold import under
  // full-monorepo parallel load (confirmed by letting it run to completion;
  // this is the SAME "heavy-import-timeout" flake class this project's own
  // history already documents repeatedly for other files, not a hang), never
  // slow in isolation (~3s) or under lighter parallel load (~8s).
  it("Studio handlers forward to the correct studio-service function with the same arguments", async () => {
    const routes = await import("./admin-routes.js");
    const studio = await import("../application/studio-service.js");

    await routes.handleCreateStudioDraft(ctx, "def-1", "user-1");
    expect(studio.createDraft).toHaveBeenCalledWith(ctx, "def-1", "user-1");

    await routes.handleGetStudioDraft(ctx, "draft-1");
    expect(studio.getDraft).toHaveBeenCalledWith(ctx, "draft-1");

    await routes.handleDeleteStudioDraft(ctx, "draft-1");
    expect(studio.deleteDraft).toHaveBeenCalledWith(ctx, "draft-1");

    const purposeInput = { instructions: "hi" };
    await routes.handleSubmitStudioPurposeStep(ctx, "draft-1", purposeInput);
    expect(studio.submitPurposeStep).toHaveBeenCalledWith(ctx, "draft-1", purposeInput);

    const audienceInput = { trustLevel: "SemiTrusted" as const };
    await routes.handleSubmitStudioAudienceStep(ctx, "draft-1", audienceInput);
    expect(studio.submitAudienceStep).toHaveBeenCalledWith(ctx, "draft-1", audienceInput);

    const skillsInput = { skills: ["a@1"] };
    await routes.handleSubmitStudioSkillsStep(ctx, "draft-1", skillsInput);
    expect(studio.submitSkillsStep).toHaveBeenCalledWith(ctx, "draft-1", skillsInput);

    const toolsInput = { capabilityGroups: ["Billing"] };
    await routes.handleSubmitStudioToolsStep(ctx, "draft-1", toolsInput);
    expect(studio.submitToolsStep).toHaveBeenCalledWith(ctx, "draft-1", toolsInput);

    const knowledgeInput = { knowledge: undefined };
    await routes.handleSubmitStudioKnowledgeStep(ctx, "draft-1", knowledgeInput);
    expect(studio.submitKnowledgeStep).toHaveBeenCalledWith(ctx, "draft-1", knowledgeInput);

    const guardrailsInput = { minConfidenceForAutonomy: 0.6, escalateOn: [] };
    await routes.handleSubmitStudioGuardrailsStep(ctx, "draft-1", guardrailsInput);
    expect(studio.submitGuardrailsStep).toHaveBeenCalledWith(ctx, "draft-1", guardrailsInput);

    const modelBudgetsInput = { modelRoute: "chat.primary", maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 };
    await routes.handleSubmitStudioModelBudgetsStep(ctx, "draft-1", modelBudgetsInput);
    expect(studio.submitModelBudgetsStep).toHaveBeenCalledWith(ctx, "draft-1", modelBudgetsInput);

    const memoryInput = { strategy: "rolling-window", maxTurns: 20 };
    await routes.handleSubmitStudioMemoryStep(ctx, "draft-1", memoryInput);
    expect(studio.submitMemoryStep).toHaveBeenCalledWith(ctx, "draft-1", memoryInput);

    const evalsInput = { includedSkillEvalCaseIds: ["case-1"] };
    await routes.handleSubmitStudioEvalsStep(ctx, "draft-1", evalsInput);
    expect(studio.submitEvalsStep).toHaveBeenCalledWith(ctx, "draft-1", evalsInput);

    await routes.handleListAvailableSkillEvalCases(ctx, ["a@1"]);
    expect(studio.listAvailableSkillEvalCases).toHaveBeenCalledWith(ctx, ["a@1"]);

    const submitInput = { version: "1.0.0", modelRouteKey: "chat.primary" };
    await routes.handleSubmitStudioDraft(ctx, "draft-1", submitInput, "user-1");
    expect(studio.submitDraft).toHaveBeenCalledWith(ctx, "draft-1", submitInput, "user-1");

    await routes.handlePreviewStudioDraft(ctx, "draft-1", "1.0.0", "ADK");
    expect(studio.previewDraft).toHaveBeenCalledWith(ctx, "draft-1", "1.0.0", "ADK");
  }, 60_000);

  it("Blueprints handlers forward to the correct blueprint-service function with the same arguments", async () => {
    const routes = await import("./admin-routes.js");
    const blueprints = await import("../application/blueprint-service.js");

    const createInput = { name: "Support Triage", artifact: {} as never };
    await routes.handleCreateAgentBlueprint(ctx, createInput, "user-1");
    expect(blueprints.createBlueprint).toHaveBeenCalledWith(ctx, createInput, "user-1");

    await routes.handleListAgentBlueprints(ctx);
    expect(blueprints.listBlueprints).toHaveBeenCalledWith(ctx);

    await routes.handleGetAgentBlueprint(ctx, "blueprint-1");
    expect(blueprints.getBlueprint).toHaveBeenCalledWith(ctx, "blueprint-1");

    await routes.handleInstantiateBlueprintAsDraft(ctx, "blueprint-1", "def-1", "user-1");
    expect(blueprints.instantiateBlueprintAsDraft).toHaveBeenCalledWith(ctx, "blueprint-1", "def-1", "user-1");
  });

  it("handleHarvestEvalCase forwards to harvestEvalCase (FR-AGT-16)", async () => {
    const routes = await import("./admin-routes.js");
    const harvesting = await import("../application/harvesting-service.js");

    const harvestInput = { evalSuiteId: "suite-1", source: "HarvestedConversation" as const, sourceRef: "conv-1", name: "case", inputTranscript: [] };
    await routes.handleHarvestEvalCase(ctx, harvestInput);
    expect(harvesting.harvestEvalCase).toHaveBeenCalledWith(ctx, harvestInput);
  });
});
