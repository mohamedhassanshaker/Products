/**
 * Reconstructs a `Document`-source's original pasted/uploaded text from its already-stored
 * `Chunks`, so **"Re-crawl now" can re-chunk the same stored text** (this wave's scope note
 * for the sources tab) without a blob-storage adapter.
 *
 * `SourceDocuments.storageRef` is `NVarChar(500)` (`prisma/tenant/schema.prisma`) — a
 * *reference* to a blob location, not a place to hold arbitrary document text. No blob
 * store exists anywhere in this codebase (confirmed: nothing under `modules/platform/
 * adapters/outbound` implements one), and building one is out of this wave's scope. Rather
 * than invent a second, undocumented text-storage convention, this reconstructs the
 * original string from `Chunk.charStart`/`charEnd` — offsets into that original string,
 * which chunking already records for every chunk (`prisma/tenant/schema.prisma`'s own
 * `Chunk` doc comment: `CK_Chunks_offsets CHECK (charEnd > charStart)`).
 *
 * This is exact, not approximate, *provided* chunking is forward-only with no gaps — true
 * by construction for `apps/ai`'s `/knowledge/ingest/chunk` endpoint, which slices one
 * input string into overlapping-or-adjacent windows in ordinal order. Walking chunks in
 * ordinal order and appending only the characters beyond the previous chunk's end recovers
 * the original text byte-for-byte, including the overlapped regions (each overlap is a
 * suffix of the previous chunk and a prefix of the next one covering the *same* original
 * characters, so keeping the first occurrence and skipping the rest is correct, not lossy).
 */

export interface ReconstructableChunk {
  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
}

export interface DocumentReconstructionResult {
  readonly ok: true;
  readonly text: string;
}

export type DocumentReconstructionFailure =
  /** A gap exists between two consecutive chunks' offsets — reconstruction cannot recover the characters in the gap, so it refuses rather than silently omitting them. */
  | { readonly ok: false; readonly reason: "gap"; readonly afterOrdinal: number }
  | { readonly ok: false; readonly reason: "no_chunks" };

export function reconstructDocumentText(
  chunks: readonly ReconstructableChunk[],
): DocumentReconstructionResult | DocumentReconstructionFailure {
  if (chunks.length === 0) return { ok: false, reason: "no_chunks" };

  const ordered = [...chunks].sort((a, b) => a.ordinal - b.ordinal);
  let text = "";
  let coveredUpTo = 0;

  for (const chunk of ordered) {
    if (chunk.charStart > coveredUpTo) {
      return { ok: false, reason: "gap", afterOrdinal: chunk.ordinal };
    }
    const newPortionStart = Math.max(chunk.charStart, coveredUpTo) - chunk.charStart;
    if (newPortionStart < chunk.text.length) {
      text += chunk.text.slice(newPortionStart);
    }
    coveredUpTo = Math.max(coveredUpTo, chunk.charEnd);
  }

  return { ok: true, text };
}
