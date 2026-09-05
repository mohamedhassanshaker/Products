/**
 * Cross-module text-extraction vocabulary (migration plan Phase 6) — mirrors
 * `legacy/api/src/common/util/chunking.util.ts`'s own shape exactly, since
 * `infrastructure/text-extraction/pdf-text-extractor.ts`, `server/pdf-processing`'s generation
 * strategies, and `server/curricula`'s document ingestion all need to agree on "one page's raw
 * extracted text" without any of them depending on another's module internals.
 *
 * `PageText` alone was ported in sub-slice "6a" (exam extraction consumes whole per-page text
 * directly, LLD §9.3: "Extraction unit: one page"). Sub-slice "6b" (this dispatch) ports
 * `chunkPages`/`ChunkResult` too, exactly as that deferral note said whichever sub-slice added the
 * first real chunking consumer should — three landed at once: `planLessonBatches` (excerpt
 * segmentation for FR-PDF-4's lesson batches), `ReferenceIndexingService` (FR-PDF-6), and
 * `CurriculaService.uploadDocument` (FR-CUR-2's Curriculum document ingestion). Pure and I/O-free
 * (no Next.js/TypeORM/network import) so it is exercised entirely with unit tests.
 *
 * FR-CUR-2's "overlapping, context-preserving chunks tagged with source page" splitter (LLD §8.4/
 * §9.7's chunk target/overlap: 1500/200 chars, cut on paragraph -> sentence -> hard).
 *
 * Chunking happens **per page**, never across a page boundary: `PageText.pageNumber` is carried onto
 * every chunk derived from that page (`ChunkResult.pageNumber`), which is what lets the
 * `<prefix>_chunks` collection's `pageNumber` payload field cite a single, correct originating page
 * for FR-CUR-3 (search results with "originating document and page"). A chunk spanning two pages
 * could not honestly report one page number.
 */

/** One page's raw extracted text, 1-based page numbering (matches how a human refers to "page 3"). */
export interface PageText {
  pageNumber: number;
  text: string;
}

/** One chunk of a document's extracted text, ready to be embedded and upserted into the tenant's
 * `<prefix>_chunks` collection. `chunkIndex` is a single, monotonically increasing counter across the
 * *entire* document (not reset per page) — this is what the chunk point-id logical key
 * (`"{documentId}:{chunkIndex}"`) requires to stay collision-free within one document. */
export interface ChunkResult {
  chunkIndex: number;
  pageNumber: number;
  text: string;
}

const PARAGRAPH_BREAK = '\n\n';
/** A cut point is only accepted if it falls in the back half of the current window — otherwise a
 * document with one paragraph break very early in an otherwise-long page would produce a pathologically
 * short first chunk instead of actually approaching `chunkSizeChars`. */
const MIN_CUT_FRACTION = 0.5;
/** Sentence-ending punctuation immediately followed by whitespace — checked in this order so a
 * period inside "e.g." or "Fig. 3" is far less likely to be (mis)chosen over a genuine paragraph
 * break, though this heuristic (like any regex-based sentence splitter) is not perfect. */
const SENTENCE_END_PATTERN = /[.!?][ \n]/g;

/**
 * Splits `pages` into overlapping, page-tagged chunks. Empty/whitespace-only pages contribute zero
 * chunks (this function does not itself decide "no extractable text at all" — that whole-document
 * check happens one layer up, before this is ever called, per FR-CUR-2's pre-embedding-cost
 * rejection; a document can legitimately have some blank pages interleaved with real content).
 *
 * @param pages Extracted per-page text, in page order.
 * @param chunkSizeChars Target chunk size (LLD default 1500, `CHUNK_SIZE_CHARS`).
 * @param overlapChars Overlap between consecutive chunks *within the same page* (LLD default 200,
 *   `CHUNK_OVERLAP_CHARS`). Never applied across a page boundary — the last chunk of page N and the
 *   first chunk of page N+1 do not overlap, consistent with "chunking never crosses a page boundary".
 */
export function chunkPages(pages: PageText[], chunkSizeChars: number, overlapChars: number): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const normalized = page.text.replace(/\r\n/g, '\n');
    for (const segment of splitIntoChunks(normalized, chunkSizeChars, overlapChars)) {
      chunks.push({ chunkIndex, pageNumber: page.pageNumber, text: segment });
      chunkIndex += 1;
    }
  }

  return chunks;
}

/** Splits one page's text into overlapping segments, trimming whitespace and dropping any segment
 * that ends up empty after trimming (e.g. a page that is entirely whitespace). */
function splitIntoChunks(text: string, chunkSizeChars: number, overlapChars: number): string[] {
  const segments: string[] = [];
  const length = text.length;
  if (length === 0) return segments;

  let start = 0;
  while (start < length) {
    const windowEnd = Math.min(start + chunkSizeChars, length);
    const cut = windowEnd >= length ? length : findCutPoint(text, start, windowEnd);

    const segment = text.slice(start, cut).trim();
    if (segment.length > 0) segments.push(segment);

    if (cut >= length) break;

    // Overlap the next chunk backward from `cut`, but always make forward progress by at least one
    // full window's worth of characters (not just `start + 1`) — guards against a degenerate config
    // (`overlapChars >= chunkSizeChars`) producing a pathological number of near-duplicate,
    // one-character-apart chunks instead of simply falling back to no overlap for that step.
    const nextStart = cut - overlapChars;
    start = nextStart > start ? nextStart : start + chunkSizeChars;
  }

  return segments;
}

/** Finds the best cut point in `text[start, windowEnd]`, preferring (in order): the last paragraph
 * break, then the last sentence-ending punctuation, then a hard cut at `windowEnd` — all constrained
 * to fall no earlier than `MIN_CUT_FRACTION` of the way through the window (see that constant's doc
 * comment). */
function findCutPoint(text: string, start: number, windowEnd: number): number {
  const minCut = start + Math.floor((windowEnd - start) * MIN_CUT_FRACTION);

  const paragraphBreakAt = text.lastIndexOf(PARAGRAPH_BREAK, windowEnd);
  if (paragraphBreakAt >= minCut && paragraphBreakAt < windowEnd) {
    return paragraphBreakAt + PARAGRAPH_BREAK.length;
  }

  const sentenceCut = lastSentenceEndBefore(text, start, windowEnd, minCut);
  if (sentenceCut !== null) return sentenceCut;

  return windowEnd;
}

/** Scans `text[start, windowEnd)` for the last regex match of {@link SENTENCE_END_PATTERN} at or
 * after `minCut`, returning the index just past the matched whitespace, or `null` if none qualifies. */
function lastSentenceEndBefore(text: string, start: number, windowEnd: number, minCut: number): number | null {
  const window = text.slice(start, windowEnd);
  let bestEnd: number | null = null;
  SENTENCE_END_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END_PATTERN.exec(window)) !== null) {
    const absoluteEnd = start + match.index + match[0].length;
    if (absoluteEnd >= minCut && absoluteEnd <= windowEnd) {
      bestEnd = absoluteEnd;
    }
  }
  return bestEnd;
}
