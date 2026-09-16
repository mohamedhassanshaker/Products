import { describe, expect, it } from "vitest";
import { DetectDuplicates } from "./detect-duplicates.js";
import {
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  graphNodeRecordRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("detecting duplicate entities (FR-KNOW-09) — the seeded SEWA/du scenarios", () => {
  it("upserts a candidate for the SEWA <-> Sharjah Electricity & Water Authority pair", async () => {
    const graph = new FakeGraphRepository();
    graph.seedNode(
      graphNodeRecordRowFixture({
        id: "n1",
        label: "Provider",
        canonicalKey: "sewa",
        canonicalName: "SEWA",
      }),
    );
    graph.seedNode(
      graphNodeRecordRowFixture({
        id: "n2",
        label: "Provider",
        canonicalKey: "sharjah-electricity-water-authority",
        canonicalName: "Sharjah Electricity & Water Authority",
      }),
    );
    const ai = new FakeKnowledgeAiClient();
    ai.setDetectDuplicatesResult({
      candidates: [
        {
          leftCanonicalKey: "sewa",
          rightCanonicalKey: "sharjah-electricity-water-authority",
          leftName: "SEWA",
          rightName: "Sharjah Electricity & Water Authority",
          similarity: 0.92,
          detectionMethod: "AliasOverlap",
        },
      ],
    });

    const { candidates } = await new DetectDuplicates({ graph, ai }).execute({
      label: "Provider",
      now: NOW,
    });
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate).toBeDefined();
    expect(candidate?.state).toBe("Open");
    const [openCandidate] = await graph.listOpenDuplicateCandidates();
    expect(openCandidate?.id).toBe(candidate?.id);
  });

  it("skips a candidate naming an unknown node rather than fabricating one", async () => {
    const graph = new FakeGraphRepository();
    const ai = new FakeKnowledgeAiClient();
    ai.setDetectDuplicatesResult({
      candidates: [
        {
          leftCanonicalKey: "unknown-a",
          rightCanonicalKey: "unknown-b",
          leftName: "A",
          rightName: "B",
          similarity: 0.5,
          detectionMethod: "NormalizedName",
        },
      ],
    });
    const { candidates } = await new DetectDuplicates({ graph, ai }).execute({
      label: "Provider",
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });
});
