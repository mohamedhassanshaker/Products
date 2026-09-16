import { describe, expect, it } from "vitest";
import { RemoveSource } from "./remove-source.js";
import {
  FakeChunkRepository,
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  FakeKnowledgeSourceRepository,
  chunkRowFixture,
  graphNodeRecordRowFixture,
  knowledgeSourceRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("removing a source (FR-KNOW-04)", () => {
  it("erases the source's chunks, soft-deletes the source, and deletes entities first seen only there", async () => {
    const sources = new FakeKnowledgeSourceRepository();
    const chunks = new FakeChunkRepository();
    const graph = new FakeGraphRepository();
    const ai = new FakeKnowledgeAiClient();

    const source = knowledgeSourceRowFixture();
    sources.seed(source);
    const chunk = chunkRowFixture({ id: "chunk_1", knowledgeSourceId: source.id });
    chunks.seedChunk(chunk);
    const node = graphNodeRecordRowFixture({ id: "node_1", firstSeenChunkId: chunk.id });
    graph.seedNode(node);

    const result = await new RemoveSource({ sources, chunks, graph, ai }).execute({
      knowledgeSourceId: source.id,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, erasedChunkCount: 1, deletedEntityCount: 1 });
    expect(await sources.getSource(source.id)).toBeNull(); // soft-deleted
    expect(await chunks.countNonErasedChunksForSource(source.id)).toBe(0);
    expect(await graph.getNode(node.id)).toBeNull(); // soft-deleted
  });

  it("returns not-found for an unknown source", async () => {
    const deps = {
      sources: new FakeKnowledgeSourceRepository(),
      chunks: new FakeChunkRepository(),
      graph: new FakeGraphRepository(),
      ai: new FakeKnowledgeAiClient(),
    };
    const result = await new RemoveSource(deps).execute({ knowledgeSourceId: "missing", now: NOW });
    expect(result).toEqual({ ok: false, reason: "knowledge.source_not_found" });
  });
});
