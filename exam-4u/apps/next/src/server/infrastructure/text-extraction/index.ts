import { extractPdfPages } from './pdf-text-extractor';
import { extractPdfImages, type ExtractedImage } from './pdf-image-extractor';

export { extractPdfPages, extractPdfImages };
export type { ExtractedImage };

/**
 * `server/infrastructure/text-extraction`'s public barrel (migration plan Phase 6) — the sole module
 * allowed to import `pdf-parse` (enforced by `apps/next/.eslintrc.cjs`'s `infrastructure/
 * text-extraction` module-boundary rule, mirroring `infrastructure/vector`'s identical
 * single-chokepoint-SDK convention). Sub-slice "6a" shipped `extractPdfPages` (per-page text);
 * sub-slice "6b" adds `extractPdfImages` (FR-PDF-11's embedded-image recovery) into this same module
 * precisely because it is the second consumer of that same confined SDK. `server/pdf-processing` and
 * `server/curricula` (document ingestion) are the consumers.
 */
