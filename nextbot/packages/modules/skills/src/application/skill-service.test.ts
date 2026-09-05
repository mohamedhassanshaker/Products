import { describe, expect, it } from "vitest";
import type { SkillArtifact } from "@nextbot/contracts";
import { serializeArtifactToYaml, parseArtifactFromYaml } from "./skill-service.js";

const artifact: SkillArtifact = {
  kind: "skill",
  name: "refund_request",
  version: 1,
  trigger: "customer asks to reverse a completed payment",
  scope: { capabilityGroups: ["billing"], tools: [], knowledge: [] },
  instructions: "Confirm the invoice and the amount before refunding.",
  successCriteria: "refund issued, or a stated reason why not",
  escalateWhen: ["amount > 500"],
  evalCases: [],
};

describe("serializeArtifactToYaml / parseArtifactFromYaml (pure, no I/O)", () => {
  it("round-trips a skill artifact through YAML byte-for-byte equivalently", () => {
    const yamlText = serializeArtifactToYaml(artifact);
    expect(yamlText).toContain("name: refund_request");
    expect(parseArtifactFromYaml(yamlText)).toEqual(artifact);
  });
});
