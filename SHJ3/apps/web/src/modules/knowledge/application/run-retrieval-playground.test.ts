import { describe, expect, it } from "vitest";
import { RunRetrievalPlayground } from "./run-retrieval-playground.js";
import { FakeKnowledgeAiClient, FakeRetrievalConfigRepository } from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("the retrieval playground (FR-KNOW-15)", () => {
  it("runs the query against the AI service and persists a RetrievalPlaygroundRun", async () => {
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();
    ai.setRetrievalQueryResult({
      results: [
        {
          chunkId: "chunk_1",
          score: 0.91,
          graphScore: 0.9,
          vectorScore: 0.8,
          text: "Pay your SEWA bill online.",
          sectionPath: null,
          pageNumber: null,
          knowledgeSourceId: "source_1",
          knowledgeSourceName: "SEWA tariff schedule",
          retrievedVia: "Hybrid",
        },
      ],
      matchedSubgraph: {
        nodes: [
          { key: "service:pay-utilities-bill", label: "Service", name: "Pay utilities bill" },
        ],
        edges: [],
        renderedPath: "Service(Pay utilities bill) -> Provider(SEWA) -> Fee",
      },
      degraded: false,
      degradationReasons: [],
      rerankApplied: true,
      groundingConfidence: 0.91,
      durationMs: 120,
    });

    const { runId, result } = await new RunRetrievalPlayground({ retrievalConfig, ai }).execute({
      query: "pay SEWA bill",
      knowledgeCollectionIds: null,
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(runId).toBeTruthy();
    expect(result.results).toHaveLength(1);
    expect(retrievalConfig.playgroundRuns).toHaveLength(1);
    expect(retrievalConfig.playgroundRuns[0]?.topScore).toBe(0.91);
    expect(retrievalConfig.playgroundRuns[0]?.matchedSubgraph).toContain("Pay utilities bill");
  });
});
