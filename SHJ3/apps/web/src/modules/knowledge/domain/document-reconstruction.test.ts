import { describe, expect, it } from "vitest";
import { reconstructDocumentText, type ReconstructableChunk } from "./document-reconstruction.js";

describe("reconstructing a Document source's original text from its chunks", () => {
  it("recovers the exact original string from non-overlapping chunks", () => {
    const original = "Pay your SEWA bill online within 30 days of issue.";
    const chunks: readonly ReconstructableChunk[] = [
      { ordinal: 0, charStart: 0, charEnd: 20, text: original.slice(0, 20) },
      { ordinal: 1, charStart: 20, charEnd: original.length, text: original.slice(20) },
    ];
    const result = reconstructDocumentText(chunks);
    expect(result).toEqual({ ok: true, text: original });
  });

  it("recovers the exact original string from overlapping chunks (chunkOverlapTokens > 0)", () => {
    const original = "Pay your SEWA bill online within 30 days of issue, or a late fee applies.";
    const chunks: readonly ReconstructableChunk[] = [
      { ordinal: 0, charStart: 0, charEnd: 30, text: original.slice(0, 30) },
      // Overlaps the previous chunk's tail (chars 20-30 repeated) — the realistic shape a
      // real chunker with overlap produces.
      { ordinal: 1, charStart: 20, charEnd: 55, text: original.slice(20, 55) },
      { ordinal: 2, charStart: 45, charEnd: original.length, text: original.slice(45) },
    ];
    const result = reconstructDocumentText(chunks);
    expect(result).toEqual({ ok: true, text: original });
  });

  it("is order-independent — chunks arriving out of ordinal order still reconstruct correctly", () => {
    const original = "Alpha Beta Gamma";
    const chunks: readonly ReconstructableChunk[] = [
      { ordinal: 1, charStart: 6, charEnd: original.length, text: original.slice(6) },
      { ordinal: 0, charStart: 0, charEnd: 6, text: original.slice(0, 6) },
    ];
    expect(reconstructDocumentText(chunks)).toEqual({ ok: true, text: original });
  });

  it("refuses with a named gap rather than silently omitting missing characters", () => {
    const chunks: readonly ReconstructableChunk[] = [
      { ordinal: 0, charStart: 0, charEnd: 10, text: "0123456789" },
      { ordinal: 1, charStart: 15, charEnd: 20, text: "abcde" },
    ];
    expect(reconstructDocumentText(chunks)).toEqual({ ok: false, reason: "gap", afterOrdinal: 1 });
  });

  it("refuses cleanly when there are no chunks at all", () => {
    expect(reconstructDocumentText([])).toEqual({ ok: false, reason: "no_chunks" });
  });
});
