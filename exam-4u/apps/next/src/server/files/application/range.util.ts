/**
 * Parses an HTTP `Range` header of the single-range form `bytes=start-end` (FR-FILE-2) — ported
 * verbatim (pure function, no framework dependency) from
 * `legacy/api/src/modules/files/api/files.controller.ts`'s `parseRangeHeader`. Returns:
 * - `undefined` if there is no `Range` header (caller should serve the full object), or the header is
 *   present but not a `bytes=` range (per RFC 9110, an unrecognized unit is ignored, not an error);
 * - `'unsatisfiable'` if the header is a `bytes=` range but its bounds cannot be satisfied against
 *   `totalSize` (unsatisfiable range → 416);
 * - `{ start, end }` (inclusive, 0-based, always fully resolved even for the open-ended
 *   `bytes=500-` / suffix `bytes=-500` forms) otherwise.
 *
 * Only the first range in a (rare, effectively unused by real clients for this product's media
 * types) multi-range request is honored.
 */
export function parseRangeHeader(
  header: string | undefined | null,
  totalSize: number,
): { start: number; end: number } | 'unsatisfiable' | undefined {
  if (!header || !header.startsWith('bytes=')) {
    return undefined;
  }

  const spec = header.slice('bytes='.length).split(',')[0]?.trim();
  const match = /^(\d*)-(\d*)$/.exec(spec ?? '');
  if (!match || (match[1] === '' && match[2] === '')) {
    return 'unsatisfiable';
  }

  let start: number;
  let end: number;
  if (match[1] === '') {
    // Suffix form `bytes=-500`: the last 500 bytes.
    const suffixLength = Number(match[2]);
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? totalSize - 1 : Number(match[2]);
  }

  if (start > end || start >= totalSize || start < 0) {
    return 'unsatisfiable';
  }

  return { start, end: Math.min(end, totalSize - 1) };
}
