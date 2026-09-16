import { describe, expect, it } from "vitest";
import { FakeAgentBindingsRepository } from "../testing/fakes.js";
import { ReplaceChannelBindings } from "./replace-channel-bindings.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("replacing an agent version's channel bindings", () => {
  it("replaces the whole set", async () => {
    const bindings = new FakeAgentBindingsRepository();
    await bindings.replaceChannelBindings(
      "agentversion-1",
      [{ channelKey: "WebWidget", isEnabled: true }],
      NOW,
    );
    const replace = new ReplaceChannelBindings({ bindings });

    await replace.execute({
      agentVersionId: "agentversion-1",
      bindings: [
        { channelKey: "WebWidget", isEnabled: true },
        { channelKey: "WhatsApp", isEnabled: true },
      ],
      now: NOW,
    });

    const result = await bindings.listChannelBindings("agentversion-1");
    expect(result).toEqual([
      { channelKey: "WebWidget", isEnabled: true },
      { channelKey: "WhatsApp", isEnabled: true },
    ]);
  });
});
