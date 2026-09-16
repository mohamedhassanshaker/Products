import { describe, expect, it } from "vitest";
import { RecrawlSource } from "./recrawl-source.js";
import {
  FakeChunkRepository,
  FakeKnowledgeAiClient,
  FakeKnowledgeSourceRepository,
  FakeRetrievalConfigRepository,
  knowledgeSourceRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("re-crawling a Document source", () => {
  it("reconstructs the stored text, re-chunks it, and erases the prior chunks", async () => {
    const sources = new FakeKnowledgeSourceRepository();
    const chunks = new FakeChunkRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();

    const source = knowledgeSourceRowFixture({ sourceType: "Document" });
    sources.seed(source);
    const original = {
      document: {
        knowledgeSourceId: source.id,
        externalRef: "pasted:1",
        title: source.name,
        contentHash: "h",
        byteSize: 10n,
        mimeType: "text/plain",
        localeCode: "en",
        storageRef: "sql:x",
        fetchedAt: NOW,
        supersedesDocumentId: null,
        now: NOW,
      },
      chunks: [
        {
          knowledgeSourceId: source.id,
          knowledgeCollectionId: source.knowledgeCollectionId,
          ordinal: 0,
          text: "Original stored text.",
          tokenCount: 3,
          charStart: 0,
          charEnd: 21,
          contentHash: "h0",
          sectionPath: null,
          pageNumber: null,
          localeCode: "en",
        },
      ],
    };
    await chunks.createDocumentWithChunks(original);

    ai.setChunkDocumentResult({
      chunks: [
        {
          ordinal: 0,
          text: "Original stored text.",
          tokenCount: 3,
          charStart: 0,
          charEnd: 21,
          contentHash: "h0b",
        },
      ],
    });

    const result = await new RecrawlSource({ sources, chunks, retrievalConfig, ai }).execute({
      knowledgeSourceId: source.id,
      ranByStaffUserId: "usr_admin",
      now: new Date(NOW.getTime() + 1000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chunksWritten).toBe(1);
    expect(ai.chunkDocumentCalls[0]?.documentText).toBe("Original stored text.");

    const live = await chunks.listChunksBySource(source.id);
    expect(live).toHaveLength(1); // the old chunk was erased
  });

  it("refuses when there is nothing stored to re-crawl", async () => {
    const sources = new FakeKnowledgeSourceRepository();
    const chunks = new FakeChunkRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();

    const source = knowledgeSourceRowFixture({ sourceType: "Document" });
    sources.seed(source);

    const result = await new RecrawlSource({ sources, chunks, retrievalConfig, ai }).execute({
      knowledgeSourceId: source.id,
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.no_stored_text_to_recrawl" });
  });

  it("refuses re-crawl for source types this wave does not wire", async () => {
    const sources = new FakeKnowledgeSourceRepository();
    const chunks = new FakeChunkRepository();
    const retrievalConfig = new FakeRetrievalConfigRepository();
    const ai = new FakeKnowledgeAiClient();

    const source = knowledgeSourceRowFixture({ sourceType: "UrlCrawler" });
    sources.seed(source);

    const result = await new RecrawlSource({ sources, chunks, retrievalConfig, ai }).execute({
      knowledgeSourceId: source.id,
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      reason: "knowledge.recrawl_not_supported_for_source_type",
    });
  });
});
