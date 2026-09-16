/**
 * Brand asset validation — the pure rules `UploadBrandAsset` (application layer)
 * enforces before a single byte reaches storage or the database.
 *
 * Closing the gap `tasks/todo.md`'s SkinEditor review entry named plainly: "Logo/
 * favicon upload is not built. No `BrandAsset`-writing adapter exists anywhere in
 * this codebase." `prisma/tenant/schema.prisma`'s `BrandAsset` model and
 * `prisma/sql/001_constraints.sql`'s `CK_BrandAssets_mimeAllowed`/`_byteSize` were
 * already built (an earlier wave's theming-backend pass) — this module is the
 * missing write path, not a schema change.
 *
 * ## Why SVG is rejected here even though the DB CHECK constraint allows it
 *
 * `CK_BrandAssets_mimeAllowed` permits `image/svg+xml` alongside the three raster
 * types — a real, deliberate schema decision (logos are commonly vector art). This
 * module does not accept it. An uploaded SVG is attacker-controlled XML that can
 * carry `<script>`, inline event handlers, or an external `<image href>` — a well-
 * known stored-XSS vector when served back to an authenticated admin's browser
 * (this project's CLAUDE.md requires exactly this class of review for anything
 * touching file/object storage or user input). Sanitising SVG for real (stripping
 * script-capable content while keeping the markup valid) needs a real, audited
 * sanitiser library — none is a dependency of this workspace today, and adding one
 * un-reviewed is the wrong tradeoff for a first cut of this feature. Restricting to
 * PNG/WebP/ICO closes the vector entirely, at the cost of vector-logo support — a
 * real, named gap (see `tasks/todo.md`'s review entry for this wave), not a silent
 * one: the DB constraint is deliberately left as-is (broader than this module
 * needs) so a future wave that adds a real SVG sanitiser only has to change this
 * one file, not the schema.
 *
 * Detection reads real magic bytes, never the client-supplied `Content-Type`
 * header or file extension — both are attacker-controlled and prove nothing about
 * what the bytes actually are.
 */

/** Mirrors `CK_BrandAssets_kind`'s closed vocabulary (`prisma/sql/001_constraints.sql`)
 *  minus `OgImage`, which no control in design-system.md §9.1's Brand section exposes
 *  today — a real, narrower scope than the column's full vocabulary, not an oversight. */
export const BRAND_ASSET_KINDS = ["LogoLight", "LogoDark", "Favicon"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

/** Mirrors `CK_BrandAssets_byteSize`'s `<= 1048576` ceiling verbatim — brand assets
 *  are inlined on the first-paint path (that constraint's own comment), so this
 *  module's own cap can never legitimately exceed the database's. */
export const MAX_BRAND_ASSET_BYTES = 1_048_576;

export type DetectedImageType =
  | { readonly mimeType: "image/png"; readonly extension: "png" }
  | { readonly mimeType: "image/webp"; readonly extension: "webp" }
  | { readonly mimeType: "image/x-icon"; readonly extension: "ico" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ICO_SIGNATURE = [0x00, 0x00, 0x01, 0x00];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Sniffs the real image format from its magic bytes — the only server-side
 * validation this codebase's own security discipline accepts (`tasks/lessons.md`'s
 * repeated "never trust a client-supplied header/name" pattern, applied here to a
 * MIME type instead of a schema path or a permission key). Returns `null` for
 * anything else, including a well-formed SVG (see this module's own doc comment)
 * and JPEG (not in `CK_BrandAssets_mimeAllowed`'s vocabulary at all).
 */
export function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return { mimeType: "image/png", extension: "png" };
  if (startsWith(bytes, ICO_SIGNATURE)) return { mimeType: "image/x-icon", extension: "ico" };
  // WEBP: a RIFF container (bytes 0-3) whose form type (bytes 8-11) is "WEBP".
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

/**
 * PNG-only dimension read (the IHDR chunk's width/height, big-endian, at a fixed
 * offset every valid PNG carries) — `BrandAsset.width`/`height` are optional
 * metadata columns, not load-bearing for rendering, so a WebP/ICO upload leaving
 * them `null` is an honest, deliberately narrow gap rather than a reason to add an
 * image-parsing dependency for two more formats. See this wave's `tasks/todo.md`
 * review entry.
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 24) return null;
  if (!asciiAt(bytes, 12, "IHDR")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}
