import { describe, expect, it } from "vitest";
import { FakeAgentBindingsRepository, FakeAgentRepository } from "../testing/fakes.js";
import { GetDraftValidation } from "./get-draft-validation.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("checking draft completeness for publish", () => {
  it("is complete when the agent has a name and at least one enabled channel", async () => {
    const agents = new FakeAgentRepository();
    const bindings = new FakeAgentBindingsRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      name: "SEWA & Utilities Billing Agent",
    });
    await bindings.replaceChannelBindings(
      agentVersionId,
      [{ channelKey: "WebWidget", isEnabled: true }],
      NOW,
    );
    const validate = new GetDraftValidation({ agents, bindings });

    const result = await validate.execute({ agentId, agentVersionId });
    expect(result).toEqual({ complete: true, missingSteps: [] });
  });

  it("flags 'channels' missing when no channel binding is enabled", async () => {
    const agents = new FakeAgentRepository();
    const bindings = new FakeAgentBindingsRepository();
    const { agentId, agentVersionId } = agents.seedAgent({ name: "Library Services Agent" });
    await bindings.replaceChannelBindings(
      agentVersionId,
      [{ channelKey: "WebWidget", isEnabled: false }],
      NOW,
    );
    const validate = new GetDraftValidation({ agents, bindings });

    const result = await validate.execute({ agentId, agentVersionId });
    expect(result).toEqual({ complete: false, missingSteps: ["channels"] });
  });

  it("flags both 'identity' and 'channels' missing when the agent cannot be found", async () => {
    const agents = new FakeAgentRepository();
    const bindings = new FakeAgentBindingsRepository();
    const validate = new GetDraftValidation({ agents, bindings });

    const result = await validate.execute({
      agentId: "agent-missing",
      agentVersionId: "agentversion-missing",
    });
    expect(result).toEqual({ complete: false, missingSteps: ["identity", "channels"] });
  });
});
