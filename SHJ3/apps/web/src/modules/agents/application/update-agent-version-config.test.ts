import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { UpdateAgentVersionConfig } from "./update-agent-version-config.js";

describe("updating a draft agent version's config", () => {
  it("updates scalar fields on a Draft version", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({});
    const agentVersionId = agents.seedVersion({ agentId, major: 0, minor: 1, status: "Draft" });
    const useCase = new UpdateAgentVersionConfig({ agents });

    const result = await useCase.execute({
      agentVersionId,
      systemPrompt: "You are a helpful assistant.",
      tone: "Formal",
      now: new Date(),
    });

    expect(result).toEqual({ ok: true });
    const version = await agents.getVersion(agentVersionId);
    expect(version?.systemPrompt).toBe("You are a helpful assistant.");
    expect(version?.tone).toBe("Formal");
  });

  it("rejects an edit against an already-Published version (TR_AgentVersions_publishedImmutable, 51110)", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({});
    const agentVersionId = agents.seedVersion({ agentId, major: 1, minor: 0, status: "Published" });
    const useCase = new UpdateAgentVersionConfig({ agents });

    const result = await useCase.execute({
      agentVersionId,
      systemPrompt: "New prompt",
      now: new Date(),
    });

    expect(result).toEqual({
      ok: false,
      reason: "immutable",
      message: "A Published agent version is immutable; create a new version instead (B2, B3).",
    });
  });
});
