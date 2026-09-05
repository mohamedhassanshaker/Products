/**
 * Magic-byte (file-signature) sniffing for the three image MIME types FR-IAM-4 allows for a profile
 * picture (JPEG/PNG/WebP) — ported verbatim from `legacy/api/src/common/util/image-signature.util.ts`.
 * Deliberately does **not** trust the client-supplied `Content-Type` — a client can freely lie about
 * a file's declared type, so the only safe check is reading the file's actual leading bytes.
 */
export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Returns the sniffed MIME type for `buffer`'s content, or `null` if it matches none of the three
 * allowed signatures (including too-short buffers). */
export function sniffImageMimeType(buffer: Buffer): SniffedImageType | null {
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isPng(buffer)) return 'image/png';
  if (isWebp(buffer)) return 'image/webp';
  return null;
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buffer.length >= signature.length && signature.every((byte, i) => buffer[i] === byte);
}

function isWebp(buffer: Buffer): boolean {
  // RIFF <4-byte size> WEBP
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

/** Maps a sniffed MIME type to a safe, fixed file extension for the generated storage key — never
 * derived from the client-supplied original filename (which could contain anything). */
export function extensionForImageType(type: SniffedImageType): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
