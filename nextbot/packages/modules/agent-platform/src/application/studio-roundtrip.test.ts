import { describe, expect, it } from "vitest";
import type { StudioDraftPayload } from "../infrastructure/studio-draft-repository.js";
import { composeArtifactFromDraft } from "./studio-service.js";
import { serializeArtifactToYaml, parseArtifactFromYaml } from "./agent-definition-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) — the
 * regression guard the LLD names as "a required test property, not merely a
 * nice-to-have": every Studio output must round-trip through Text mode
 * unchanged — `render(parse(yaml)) === yaml` byte-for-byte after
 * canonicalisation. Text mode's own "canonicalisation" IS
 * `serializeArtifactToYaml` (plain `js-yaml` `dump`, deterministic for a
 * plain object with stable key insertion order) — so this test canonicalises
 * once via that same function, then asserts `serialize(parse(yaml)) === yaml`
 * for a corpus of Studio-composed artifacts, proving the YAML never stops
 * being the single source of truth between the two authoring modes.
 */
function draftPayload(overrides: Partial<StudioDraftPayload> = {}): StudioDraftPayload {
  return {
    purpose: { instructions: "You are a helpful support agent." },
    audience: { trustLevel: "SemiTrusted", channelTypes: ["WebWidget", "WhatsApp"] },
    skills: { skills: ["refund_request@3"] },
    tools: { capabilityGroups: ["Billing"], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: ["LowConfidence"], maskingFloor: { Transcript: "FullMask" } },
    modelBudgets: { modelRoute: "chat.primary", maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    ...overrides,
  };
}

describe("Studio round-trip regression guard — render(parse(yaml)) === yaml, byte-for-byte", () => {
  const corpus: Array<{ label: string; payload: StudioDraftPayload }> = [
    { label: "a full, every-step-populated draft", payload: draftPayload() },
    { label: "a minimal draft (only Purpose staged)", payload: { purpose: { instructions: "Minimal." } } },
    {
      label: "a knowledge-scoped draft",
      payload: draftPayload({
        knowledge: {
          knowledge: {
            collections: ["billing_policy@1"],
            strategy: "auto",
            maxHops: 2,
            maxExpansions: 2,
            minCitations: 1,
            refuseWhenUngrounded: true,
            budget: { usdPerTurn: 0.5, seconds: 20 },
          },
        },
      }),
    },
    { label: "a draft with no audience/masking declared at all", payload: { purpose: { instructions: "No audience declared." } } },
  ];

  for (const { label, payload } of corpus) {
    it(`round-trips unchanged: ${label}`, () => {
      const artifact = composeArtifactFromDraft("studio-roundtrip-test", "1.0.0", "ADK", payload);
      const canonicalYaml = serializeArtifactToYaml(artifact);
      const reparsed = parseArtifactFromYaml(canonicalYaml);
      const rerendered = serializeArtifactToYaml(reparsed as typeof artifact);
      expect(rerendered).toBe(canonicalYaml);
    });
  }
});
