import { describe, expect, it } from "vitest";
import { UpdateFlowAssistantConfig } from "./update-flow-assistant-config.js";
import { FakeFlowAssistantConfigRepository } from "../testing/fakes.js";
import { FLOW_ASSISTANT_CONFIG_DEFAULTS } from "../domain/flow-assistant-config.js";

const NOW = new Date("2026-09-12T09:00:00.000Z");

describe("updating the Flow Designer AI sidebar's tenant-wide model", () => {
  it("saves a valid primary/fallback model and round-trips it", async () => {
    const flowAssistantConfig = new FakeFlowAssistantConfigRepository();
    const result = await new UpdateFlowAssistantConfig({ flowAssistantConfig }).execute({
      primaryModel: "openai/gpt-5",
      fallbackModel: "anthropic/claude-sonnet-5",
      updatedByStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.primaryModel).toBe("openai/gpt-5");
    expect(result.config.fallbackModel).toBe("anthropic/claude-sonnet-5");

    const reloaded = await flowAssistantConfig.ensureTenantConfig(NOW);
    expect(reloaded.primaryModel).toBe("openai/gpt-5");
  });

  it("treats a blank fallback model as no fallback", async () => {
    const flowAssistantConfig = new FakeFlowAssistantConfigRepository();
    const result = await new UpdateFlowAssistantConfig({ flowAssistantConfig }).execute({
      primaryModel: "openai/gpt-5",
      fallbackModel: "   ",
      updatedByStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.fallbackModel).toBeNull();
  });

  it("refuses an empty primary model, before touching the repository", async () => {
    const flowAssistantConfig = new FakeFlowAssistantConfigRepository();
    const result = await new UpdateFlowAssistantConfig({ flowAssistantConfig }).execute({
      primaryModel: "   ",
      fallbackModel: null,
      updatedByStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "flows.primary_model_required" });
  });

  it("ensureTenantConfig seeds the documented defaults on first use", async () => {
    const flowAssistantConfig = new FakeFlowAssistantConfigRepository();
    const config = await flowAssistantConfig.ensureTenantConfig(NOW);
    expect(config.primaryModel).toBe(FLOW_ASSISTANT_CONFIG_DEFAULTS.primaryModel);
    expect(config.fallbackModel).toBeNull();
  });
});
