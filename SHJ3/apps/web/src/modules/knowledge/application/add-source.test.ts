import { describe, expect, it } from "vitest";
import { AddSource } from "./add-source.js";
import {
  FakeChunkRepository,
  FakeKnowledgeAiClient,
  FakeKnowledgeSourceRepository,
  FakeRetrievalConfigRepository,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function buildDeps() {
  const sources = new FakeKnowledgeSourceRepository();
  const chunks = new FakeChunkRepository();
  const retrievalConfig = new FakeRetrievalConfigRepository();
  const ai = new FakeKnowledgeAiClient();
  return { sources, chunks, retrievalConfig, ai };
}

describe("adding a Document source", () => {
  it("chunks the pasted text for real and writes chunks Pending, at 0% indexed", async () => {
    const deps = buildDeps();
    deps.ai.setChunkDocumentResult({
      chunks: [
        {
          ordinal: 0,
          text: "Pay your SEWA bill online.",
          tokenCount: 6,
          charStart: 0,
          charEnd: 27,
          contentHash: "h0",
        },
        {
          ordinal: 1,
          text: "Late fees apply after 30 days.",
          tokenCount: 6,
          charStart: 27,
          charEnd: 58,
          contentHash: "h1",
        },
      ],
    });

    const { source, chunksWritten } = await new AddSource(deps).execute({
      name: "SEWA tariff schedule",
      sourceType: "Document",
      location: "pasted-text",
      schedule: "Manual",
      credentialSecretRef: null,
      documentText: "Pay your SEWA bill online. Late fees apply after 30 days.",
      localeCode: "en",
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(chunksWritten).toBe(2);
    expect(source.indexedPercent).toBe(0);
    const storedChunks = await deps.chunks.listChunksBySource(source.id);
    expect(storedChunks).toHaveLength(2);
    expect(storedChunks.every((chunk) => chunk.vectorState === "Pending")).toBe(true);
  });

  it("refuses an empty document text for a Document source", async () => {
    const deps = buildDeps();
    await expect(
      new AddSource(deps).execute({
        name: "Empty",
        sourceType: "Document",
        location: "pasted-text",
        schedule: "Manual",
        credentialSecretRef: null,
        documentText: "   ",
        localeCode: "en",
        ranByStaffUserId: "usr_admin",
        now: NOW,
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("persists the other four source types as real rows with no fetch mechanics, honestly at 0%", async () => {
    const deps = buildDeps();
    const { source, chunksWritten } = await new AddSource(deps).execute({
      name: "Sharjah.gov crawler",
      sourceType: "UrlCrawler",
      location: "https://sharjah.gov.ae",
      schedule: "Weekly",
      credentialSecretRef: null,
      documentText: null,
      localeCode: "en",
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(chunksWritten).toBe(0);
    expect(source.status).toBe("Idle");
    expect(source.indexedPercent).toBe(0);
  });
});
