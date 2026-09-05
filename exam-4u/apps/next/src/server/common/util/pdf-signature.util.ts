/**
 * Magic-byte (file-signature) sniffing for PDF uploads (migration plan Phase 6, FR-PDF-1) — ported
 * verbatim from `legacy/api/src/common/util/pdf-signature.util.ts`. Mirrors
 * `zip-signature.util.ts`/`image-signature.util.ts`'s established judgment call: never trust the
 * client-supplied `Content-Type`/original filename — the only safe check is the file's actual leading
 * bytes.
 *
 * No module-boundary ESLint rule protects this file (matches every other `common/util/**` file's own
 * "common/ is shared-kernel, stateless, pure code" precedent — nothing here holds state or a resource
 * to protect).
 */

/** The canonical PDF magic bytes ("%PDF-"), per the PDF spec's required file header. A small amount of
 * leading garbage before the header is tolerated by real-world PDF producers/some scanners, so this
 * checks the first 1024 bytes for the marker rather than requiring it at offset 0 — the same tolerance
 * window commonly used by PDF sniffers, without being so permissive that it stops meaning anything (an
 * arbitrary file poisoned with `%PDF-` bytes deep inside would still fail the eventual real parse in
 * `extractPdfPages`, which is the actual point at which unparsable content is rejected). */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const SNIFF_WINDOW_BYTES = 1024;

/** Returns whether `buffer`'s leading bytes look like a genuine PDF file. */
export function isPdfSignature(buffer: Buffer): boolean {
  if (buffer.length < PDF_MAGIC.length) return false;
  const window = buffer.subarray(0, Math.min(buffer.length, SNIFF_WINDOW_BYTES));
  return window.indexOf(PDF_MAGIC) !== -1;
}
