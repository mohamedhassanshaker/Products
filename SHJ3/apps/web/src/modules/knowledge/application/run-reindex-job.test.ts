import { describe, expect, it } from "vitest";
import { RunReindexJob } from "./run-reindex-job.js";
import {
  FakeChunkRepository,
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  FakeReindexJobRepository,
  FakeRetrievalConfigRepository,
  chunkRowFixture,
  reindexJobRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");
const SOURCE_ID = "source_1";
const COLLECTION_ID = "collection_1";

function seedMixedChunks(chunks: FakeChunkRepository): void {
  chunks.seedChunk(
    chunkRowFixture({
      id: "c1",
      knowledgeSourceId: SOURCE_ID,
      knowledgeCollectionId: COLLECTION_ID,
      vectorState: "Indexed",
      graphState: "Indexed",
    }),
  );
  chunks.seedChunk(
    chunkRowFixture({
      id: "c2",
      knowledgeSourceId: SOURCE_ID,
      knowledgeCollectionId: COLLECTION_ID,
      vectorState: "Indexed",
      graphState: "Indexed",
    }),
  );
  chunks.seedChunk(
    chunkRowFixture({
      id: "c3",
      knowledgeSourceId: SOURCE_ID,
      knowledgeCollectionId: COLLECTION_ID,
      vectorState: "Stale",
      graphState: "Indexed",
    }),
  );
}

function emptyEmbedResult() {
  return { results: [], graphWrites: [], edgeWrites: [] };
}

describe("running a re-index job — the named hard invariant of this wave", () => {
  it("EmbeddingModelChange re-processes every in-scope chunk, including ones already Indexed", async () => {
    const chunks = new FakeChunkRepository();
    seedMixedChunks(chunks);
    const graph = new FakeGraphRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const reindexJobs = new FakeReindexJobRepository();
    const ai = new FakeKnowledgeAiClient();
    ai.setEmbedAndIndexResult(emptyEmbedResult());

    const job = reindexJobRowFixture({
      id: "job1",
      scope: "Source",
      knowledgeSourceId: SOURCE_ID,
      reason: "EmbeddingModelChange",
      state: "Queued",
    });
    reindexJobs.seed(job);

    const result = await new RunReindexJob({
      reindexJobs,
      chunks,
      graph,
      retrievalConfig,
      ai,
    }).execute({
      jobId: job.id,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, chunksProcessed: 3 });
    const submittedIds = ai.embedAndIndexCalls
      .flatMap((call) => call.chunks.map((c) => c.chunkId))
      .sort();
    expect(submittedIds).toEqual(["c1", "c2", "c3"]); // ALL three, not just c3 (the only Stale one)

    const completed = await reindexJobs.get(job.id);
    expect(completed?.state).toBe("Completed");
    expect(completed?.progressPercent).toBe(100);
  });

  it("Reconciliation re-processes only the drifted chunk, proving the two reasons genuinely diverge", async () => {
    const chunks = new FakeChunkRepository();
    seedMixedChunks(chunks);
    const graph = new FakeGraphRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const reindexJobs = new FakeReindexJobRepository();
    const ai = new FakeKnowledgeAiClient();
    ai.setEmbedAndIndexResult(emptyEmbedResult());

    const job = reindexJobRowFixture({
      id: "job2",
      scope: "Source",
      knowledgeSourceId: SOURCE_ID,
      reason: "Reconciliation",
      state: "Queued",
    });
    reindexJobs.seed(job);

    const result = await new RunReindexJob({
      reindexJobs,
      chunks,
      graph,
      retrievalConfig,
      ai,
    }).execute({
      jobId: job.id,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, chunksProcessed: 1 });
    const submittedIds = ai.embedAndIndexCalls.flatMap((call) => call.chunks.map((c) => c.chunkId));
    expect(submittedIds).toEqual(["c3"]);
  });

  it("refuses to run a job that is not Queued", async () => {
    const chunks = new FakeChunkRepository();
    const graph = new FakeGraphRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const reindexJobs = new FakeReindexJobRepository();
    const ai = new FakeKnowledgeAiClient();
    const job = reindexJobRowFixture({ id: "job3", state: "Completed" });
    reindexJobs.seed(job);

    const result = await new RunReindexJob({
      reindexJobs,
      chunks,
      graph,
      retrievalConfig,
      ai,
    }).execute({
      jobId: job.id,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.job_not_queued" });
  });
});
