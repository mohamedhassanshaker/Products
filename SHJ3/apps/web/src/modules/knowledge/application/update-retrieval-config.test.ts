import { describe, expect, it } from "vitest";
import { UpdateRetrievalConfig } from "./update-retrieval-config.js";
import { FakeRetrievalConfigRepository } from "../testing/fakes.js";
import { RETRIEVAL_CONFIG_DEFAULTS } from "../domain/retrieval-config.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function validInput(overrides: Partial<Parameters<UpdateRetrievalConfig["execute"]>[0]> = {}) {
  return {
    chunkSizeTokens: RETRIEVAL_CONFIG_DEFAULTS.chunkSizeTokens,
    chunkOverlapTokens: RETRIEVAL_CONFIG_DEFAULTS.chunkOverlapTokens,
    embeddingModel: RETRIEVAL_CONFIG_DEFAULTS.embeddingModel,
    embeddingDimension: RETRIEVAL_CONFIG_DEFAULTS.embeddingDimension,
    graphWeight: 0.8,
    vectorWeight: 0.2,
    topK: 8,
    rerankerEnabled: true,
    rerankerModel: "rerank-v3.5",
    rerankCandidateCount: 40,
    minGroundingConfidence: 0.6,
    defaultConflictPolicy: "PreferMostRecentlyUpdated" as const,
    maxGraphHops: 3,
    now: NOW,
    ...overrides,
  };
}

describe("updating the retrieval configuration (FR-KNOW-11/12/13)", () => {
  it("saves valid weights and reports no model change", async () => {
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const result = await new UpdateRetrievalConfig({ retrievalConfig }).execute(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.graphWeight).toBe(0.8);
    expect(result.modelChanged).toBe(false);
  });

  it("reports modelChanged when embeddingModel changes, for the confirmation dialog (FR-KNOW-13)", async () => {
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const result = await new UpdateRetrievalConfig({ retrievalConfig }).execute(
      validInput({ embeddingModel: "text-embedding-3-small", embeddingDimension: 1536 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modelChanged).toBe(true);
  });

  it("refuses weights that do not sum to one, before touching the repository", async () => {
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const result = await new UpdateRetrievalConfig({ retrievalConfig }).execute(
      validInput({ graphWeight: 0.7, vectorWeight: 0.5 }),
    );
    expect(result).toEqual({ ok: false, reason: "knowledge.weights_must_sum_to_one" });
  });

  it("refuses an overlap that is not smaller than the chunk size", async () => {
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const result = await new UpdateRetrievalConfig({ retrievalConfig }).execute(
      validInput({ chunkSizeTokens: 100, chunkOverlapTokens: 100 }),
    );
    expect(result).toEqual({ ok: false, reason: "knowledge.overlap_must_be_less_than_chunk_size" });
  });

  it("refuses a top-K outside 1-50", async () => {
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const result = await new UpdateRetrievalConfig({ retrievalConfig }).execute(
      validInput({ topK: 0 }),
    );
    expect(result).toEqual({ ok: false, reason: "knowledge.top_k_out_of_range" });
  });
});
