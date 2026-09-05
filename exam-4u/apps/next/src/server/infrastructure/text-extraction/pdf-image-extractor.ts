import { PDFParse } from 'pdf-parse';

/**
 * One embedded image recovered from a source PDF (migration plan Phase 6, sub-slice "6b", FR-PDF-11) —
 * ported verbatim from `legacy/api/src/infrastructure/text-extraction/pdf-image-extractor.ts`. `data`
 * is the raw encoded image bytes (PNG/JPEG, whichever pdf.js decoded it as), ready to hand straight to
 * `StoragePort.put` without any further re-encoding. `contentType` is derived from `dataUrl`'s own
 * `data:<mime>;base64,...` prefix (`pdf-parse`'s `EmbeddedImage` does not expose a MIME type field
 * directly), and `extension` is the matching file extension used for this image's storage key (LLD
 * §9.7: `tenants/{tenantId}/pdf/{sessionId}/images/{imageHash}.{ext}`).
 */
export interface ExtractedImage {
  pageNumber: number;
  data: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
}

/** `pdf-parse@2.x`'s default: images where width OR height are <= this many pixels are dropped as
 * decorative/tracking noise. Disabled (`0`) here — FR-PDF-11 makes no size distinction, and a small
 * diagram in an exam PDF is exactly the kind of image this feature exists to capture. */
const IMAGE_SIZE_THRESHOLD_DISABLED = 0;

/**
 * Extracts every embedded image from a PDF buffer, tagged with its 1-based source page number
 * (FR-PDF-11: "associated with the questions whose source location overlaps the image's page").
 * Returns an empty array for a PDF with no embedded images (e.g. a pure-text lesson document) — a
 * normal, unremarkable outcome, never an error.
 *
 * Lives in this module (rather than `server/pdf-processing`) for exactly the reason
 * `pdf-text-extractor.ts` does: it is the second file in the app that must import `pdf-parse`, and
 * `apps/next/.eslintrc.cjs`'s `infrastructure/text-extraction` module-boundary rule makes this module
 * the single chokepoint for that SDK. No new ESLint rule is needed — the existing one already covers
 * this file.
 *
 * @throws whatever `pdf-parse`/`pdfjs-dist` throws for a corrupt/unparsable PDF — callers already
 *   handle this identically to {@link import('./pdf-text-extractor').extractPdfPages}'s own equivalent
 *   failure mode (the same buffer was already successfully parsed for text by the time this runs, so
 *   this is expected to succeed in practice; defended here rather than assumed).
 */
export async function extractPdfImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getImage({ imageThreshold: IMAGE_SIZE_THRESHOLD_DISABLED });
    const images: ExtractedImage[] = [];
    for (const page of result.pages) {
      for (const image of page.images) {
        const { contentType, extension } = parseDataUrlMime(image.dataUrl);
        images.push({
          pageNumber: page.pageNumber,
          data: Buffer.from(image.data),
          contentType,
          extension,
          width: image.width,
          height: image.height,
        });
      }
    }
    return images;
  } finally {
    await parser.destroy();
  }
}

/** Parses the `data:<mime>;base64,...` prefix `EmbeddedImage.dataUrl` always carries into a
 * `{contentType, extension}` pair — falls back to `image/png`/`png` for the (never observed in
 * testing, but defended) case of a malformed/missing data URL, since `pdf-parse` always renders
 * decoded raster images as PNG when no more specific kind is determinable. */
function parseDataUrlMime(dataUrl: string): { contentType: string; extension: string } {
  const match = /^data:(image\/(\w+));base64,/.exec(dataUrl);
  if (!match) return { contentType: 'image/png', extension: 'png' };
  const [, contentType, subtype] = match;
  return { contentType, extension: subtype === 'jpeg' ? 'jpg' : subtype };
}
