/**
 * Magic-byte (file-signature) sniffing for ZIP archives — ported verbatim from
 * `legacy/api/src/common/util/zip-signature.util.ts` (HLD §5.3 "Uploads: Magic-byte checks... `PK\x03\x04`
 * for ZIP"). Never trust the client-supplied `Content-Type`/filename extension, only the file's actual
 * leading bytes — same principle `image-signature.util.ts`-equivalent checks in this app already follow
 * for avatar uploads.
 *
 * No module-boundary ESLint rule protects this file (matches `email.util.ts`/`tenant-slug.util.ts`'s own
 * "common/ is shared-kernel, stateless, pure code" precedent — nothing here holds state or a resource to
 * protect).
 *
 * A ZIP file's local-file-header signature is `PK\x03\x04` (0x50 0x4b 0x03 0x04). An **empty** archive
 * (zero entries) instead begins with the end-of-central-directory signature `PK\x05\x06`
 * (0x50 0x4b 0x05 0x06) — accepted here as "a real zip container" so an empty-but-well-formed archive is
 * rejected later for a more specific reason (no modules at all -> `INVALID_ZIP_STRUCTURE` from the
 * parser, not a generic "not a zip" error here).
 */
export function isZipMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const isLocalFileHeader = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isEmptyArchiveEocd = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x05 && buffer[3] === 0x06;
  return isLocalFileHeader || isEmptyArchiveEocd;
}
