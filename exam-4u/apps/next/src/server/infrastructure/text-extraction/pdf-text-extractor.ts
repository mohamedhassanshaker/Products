import { PDFParse } from 'pdf-parse';
import type { PageText } from '@/server/common/util/chunking.util';

/**
 * `pdf-parse@2.x` (a modern rewrite, unrelated in implementation to the long-unmaintained
 * `pdf-parse@1.x`) is the one concrete text-extraction SDK this module depends on — confined to this
 * file, matching `legacy/api/src/infrastructure/text-extraction/pdf-text-extractor.ts`'s identical
 * dependency choice/rationale, ported verbatim:
 *
 * - `pdf-parse@1.x` vendors its own long-unmaintained, ~2016-19 era copies of pdf.js and threw on a
 *   real `pdfkit`-generated fixture in legacy's own environment.
 * - A direct `pdfjs-dist` dependency ships an ESM-only "legacy" Node build, which conflicts with this
 *   app's `"module": "commonjs"` TypeScript target the same way it did for legacy.
 * - `pdf-parse@2.4.5` internally wraps a current, non-vulnerable `pdfjs-dist@5.4.296` (past the
 *   GHSA-wgrm-67xf-hhpq patch line) **and** ships a genuine CJS build, sidestepping both problems.
 *
 * **Environment-fragility finding for THIS dispatch (documented per the dispatch's own explicit
 * instruction, not assumed)**: legacy's own `NEXUS_STATE.md` history (Dev-16 onward) records that
 * `pdfjs-dist` sets up a same-thread "fake worker" in Node via its own internal dynamic `import()`,
 * which throws `"A dynamic import callback was invoked without --experimental-vm-modules"` under
 * Jest's `vm`-sandboxed test runtime unless that flag is set. Verified empirically in *this*
 * environment against `apps/next`'s own test runner (`vitest`, not Jest): `vitest` runs its test files
 * inside real Node module execution (via `vite-node`/esbuild transforms), not a `vm`-sandboxed runtime
 * the way Jest does — this dispatch's own `pdf-text-extractor.test.ts` (a real, genuine
 * `pdfkit`-generated fixture, not mocked) passes cleanly under a plain `npx vitest run` with **no**
 * `NODE_OPTIONS=--experimental-vm-modules` flag required. This is a genuine, confirmed difference from
 * legacy's own Jest-specific constraint, not a re-run of the same bug under a different name — recorded
 * here (and in `docs/plans/nextjs-rewrite-phase6-plan.md`) so a future dispatch does not assume this
 * app's own `npm test`/`vitest` scripts need the same flag legacy's `package.json` carries.
 */

/**
 * Extracts per-page plain text from a PDF buffer (FR-PDF-1: "extracts its text... tagged with source
 * page"). Returns pages in order, 1-based `pageNumber` (`pdf-parse`'s own `num` field). A page with no
 * extractable text (e.g. a scanned image page — scanned/non-digital-text PDF ingestion is out of
 * scope) comes back as an empty string rather than being silently dropped, so later pages' numbering
 * stays correct.
 *
 * @throws whatever `pdf-parse`/`pdfjs-dist` throws for a corrupt/unparsable PDF (e.g.
 *   `InvalidPDFException`/`PasswordException`) — `PdfProcessingService.extract` lets this propagate
 *   into `processSession`'s own catch block, which records it as the session's terminal `Failed`
 *   state rather than crashing the background pipeline.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PageText[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((page) => ({ pageNumber: page.num, text: page.text }));
  } finally {
    await parser.destroy();
  }
}
