import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { extractPdfPages } from './pdf-text-extractor';

/** Builds a real, minimal PDF via `pdfkit` — never mocked — matching
 * `legacy/api/src/modules/pdf-processing/application/pdf-processing.service.spec.ts`'s established
 * `buildPdf` precedent, so these assertions prove something about the real `pdf-parse`/`pdfjs-dist`
 * pipeline, not a stubbed shape. */
function buildPdf(pageTexts: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const text of pageTexts) {
      doc.addPage();
      if (text.length > 0) doc.text(text);
    }
    doc.end();
  });
}

describe('extractPdfPages (real pdf-parse/pdfjs-dist, no mock)', () => {
  it('extracts each page\'s text in order with 1-based page numbers', async () => {
    const pdf = await buildPdf(['first page content', 'second page content', 'third page content']);
    const pages = await extractPdfPages(pdf);

    expect(pages).toHaveLength(3);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages[0]?.text).toContain('first page content');
    expect(pages[1]?.pageNumber).toBe(2);
    expect(pages[1]?.text).toContain('second page content');
    expect(pages[2]?.pageNumber).toBe(3);
    expect(pages[2]?.text).toContain('third page content');
  });

  it('returns an empty string (never drops the page) for a page with no extractable text', async () => {
    const pdf = await buildPdf(['has text', '']);
    const pages = await extractPdfPages(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[1]?.text.trim()).toBe('');
    // Page numbering stays correct even though the second page contributed no text.
    expect(pages[1]?.pageNumber).toBe(2);
  });

  it('rejects for a genuinely corrupt/unparsable buffer', async () => {
    await expect(extractPdfPages(Buffer.from('%PDF-1.7\nnot actually a valid pdf body'))).rejects.toThrow();
  });
});
