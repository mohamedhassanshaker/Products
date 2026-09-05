/**
 * FR-PDF-11's "associated with the questions whose source location overlaps the image's page" rule, as
 * a pure function (migration plan Phase 6, sub-slice "6b") — ported verbatim from
 * `legacy/api/src/modules/pdf-processing/domain/page-overlap.util.ts`, matching
 * `confidence.ts`/`budget.ts`/`covered-concepts.ts`'s established precedent of a framework-free,
 * unit-tested `.ts` file living in `domain/` alongside the type-only files.
 *
 * `generated_question.source_page_range` is a free-form string written by either generation branch as
 * either a single page (`"3"`, `ExamExtractionService`'s per-page default) or an inclusive range
 * (`"3-5"`, whatever a draft's own `sourcePageRange` names). {@link parseSourcePageRange} parses both
 * shapes into a `{start, end}` pair; a malformed/unparsable value degrades to "no pages" (never
 * throws) so one bad row can never abort an entire session's image-association pass.
 */

/** Parses `generated_question.source_page_range`'s two legal shapes (`"3"` / `"3-5"`) into an
 * inclusive `{start, end}` pair. Returns `null` for `null`/blank/unparsable input — never throws. An
 * inverted range (`"5-3"`) is normalized rather than rejected. */
export function parseSourcePageRange(raw: string | null): { start: number; end: number } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  }
  const single = Number(trimmed);
  if (!Number.isFinite(single) || !Number.isInteger(single)) return null;
  return { start: single, end: single };
}

/** True when `pageNumber` (an extracted image's 1-based source page) falls anywhere inside a
 * question's own parsed `source_page_range` — the "overlap", not "exact match", relationship
 * FR-PDF-11 names, so a range-spanning question still picks up an image on any of its pages. */
export function pageOverlapsRange(pageNumber: number, range: { start: number; end: number } | null): boolean {
  if (!range) return false;
  return pageNumber >= range.start && pageNumber <= range.end;
}
