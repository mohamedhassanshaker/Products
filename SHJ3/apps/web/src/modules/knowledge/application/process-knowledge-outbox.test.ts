import { describe, expect, it } from "vitest";
import { ProcessKnowledgeOutbox } from "./process-knowledge-outbox.js";
import {
  FakeChunkRepository,
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  FakeOutboxRepository,
  FakeRetrievalConfigRepository,
  chunkRowFixture,
} from "../testing/fakes.js";
import type { OutboxEventRow } from "../ports/outbox-repository.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function seedChunkWithOutboxEvent(
  chunks: FakeChunkRepository,
  outbox: FakeOutboxRepository,
  id: string,
) {
  chunks.seedChunk(
    chunkRowFixture({ id, knowledgeSourceId: "source_1", knowledgeCollectionId: "collection_1" }),
  );
  const event: OutboxEventRow = {
    id: `event_${id}`,
    aggregateKind: "Chunk",
    aggregateId: id,
    eventType: "ChunkUpserted",
    targetStore: "Both",
    payloadJson: JSON.stringify({
      knowledgeSourceId: "source_1",
      knowledgeCollectionId: "collection_1",
    }),
    dedupeKey: `chunk-upsert-${id}`,
    state: "Pending",
    attemptCount: 0,
    maxAttempts: 8,
    availableAt: NOW,
  };
  outbox.seed(event);
}

describe("processing the knowledge outbox (§9.2)", () => {
  it("applies a real embed-and-index response: chunks become Indexed and their events Applied", async () => {
    const chunks = new FakeChunkRepository();
    const graph = new FakeGraphRepository();
    const outbox = new FakeOutboxRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();
    seedChunkWithOutboxEvent(chunks, outbox, "c1");
    ai.setEmbedAndIndexResult({
      results: [{ chunkId: "c1", vectorState: "Indexed", graphState: "Indexed", error: null }],
      graphWrites: [],
      edgeWrites: [],
    });

    const result = await new ProcessKnowledgeOutbox({
      outbox,
      chunks,
      graph,
      retrievalConfig,
      ai,
    }).execute({
      batchSize: 64,
      workerId: "test-worker",
      now: NOW,
    });

    expect(result).toEqual({ claimed: 1, applied: 1, failed: 0 });
    const [chunk] = await chunks.listChunksByIds(["c1"]);
    expect(chunk?.vectorState).toBe("Indexed");
    expect(chunk?.embeddingModel).toBeTruthy();
  });

  it("marks a chunk's event Failed (with backoff) when the AI response reports Failed for it", async () => {
    const chunks = new FakeChunkRepository();
    const graph = new FakeGraphRepository();
    const outbox = new FakeOutboxRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();
    seedChunkWithOutboxEvent(chunks, outbox, "c1");
    ai.setEmbedAndIndexResult({
      results: [
        {
          chunkId: "c1",
          vectorState: "Failed",
          graphState: "Failed",
          error: "embedding provider timed out",
        },
      ],
      graphWrites: [],
      edgeWrites: [],
    });

    const result = await new ProcessKnowledgeOutbox({
      outbox,
      chunks,
      graph,
      retrievalConfig,
      ai,
    }).execute({
      batchSize: 64,
      workerId: "test-worker",
      now: NOW,
    });

    expect(result).toEqual({ claimed: 1, applied: 0, failed: 1 });
    const event = outbox.all.find((row) => row.aggregateId === "c1");
    expect(event?.state).toBe("Failed");
  });

  it("does nothing and returns zeroes when there is no claimable work", async () => {
    const chunks = new FakeChunkRepository();
    const graph = new FakeGraphRepository();
    const outbox = new FakeOutboxRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();

    const result = await new ProcessKnowledgeOutbox({
      outbox,
      chunks,
      graph,
      retrievalConfig,
      ai,
    }).execute({
      batchSize: 64,
      workerId: "test-worker",
      now: NOW,
    });
    expect(result).toEqual({ claimed: 0, applied: 0, failed: 0 });
  });
});
