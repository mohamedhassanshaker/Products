import { describe, expect, it } from 'vitest';
import { chunkPages, type PageText } from './chunking.util';

describe('chunkPages (FR-CUR-2, ported in sub-slice 6b alongside its first real consumers)', () => {
  it('returns one chunk for a page shorter than the chunk size, trimmed', () => {
    const chunks = chunkPages([{ pageNumber: 1, text: '  hello world  ' }], 1500, 200);
    expect(chunks).toEqual([{ chunkIndex: 0, pageNumber: 1, text: 'hello world' }]);
  });

  it('contributes zero chunks for empty/whitespace-only pages', () => {
    expect(chunkPages([{ pageNumber: 1, text: '' }, { pageNumber: 2, text: '   \n  ' }], 1500, 200)).toEqual([]);
  });

  it('never lets a chunk span a page boundary — every chunk reports exactly one originating page', () => {
    const pages: PageText[] = [
      { pageNumber: 1, text: 'a'.repeat(50) },
      { pageNumber: 2, text: 'b'.repeat(50) },
    ];
    const chunks = chunkPages(pages, 1500, 200);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ pageNumber: 1 });
    expect(chunks[1]).toMatchObject({ pageNumber: 2 });
    expect(chunks[1].text).not.toContain('a');
  });

  it('increments chunkIndex monotonically across the WHOLE document, never resetting per page', () => {
    const pages: PageText[] = [
      { pageNumber: 1, text: 'a'.repeat(250) },
      { pageNumber: 2, text: 'b'.repeat(250) },
    ];
    const chunks = chunkPages(pages, 100, 0);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.chunkIndex)).size).toBe(chunks.length);
  });

  it('prefers a paragraph break in the back half of the window as the cut point', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    const chunks = chunkPages([{ pageNumber: 1, text }], 70, 0);
    expect(chunks[0].text).toBe('a'.repeat(60));
  });

  it('falls back to a sentence end when there is no qualifying paragraph break', () => {
    const text = `${'a'.repeat(59)}. ${'b'.repeat(60)}`;
    const chunks = chunkPages([{ pageNumber: 1, text }], 70, 0);
    expect(chunks[0].text.endsWith('.')).toBe(true);
  });

  it('hard-cuts at the window when neither a paragraph nor a sentence break qualifies', () => {
    const chunks = chunkPages([{ pageNumber: 1, text: 'a'.repeat(250) }], 100, 0);
    expect(chunks[0].text).toHaveLength(100);
    expect(chunks).toHaveLength(3);
  });

  it('overlaps consecutive chunks within the same page by overlapChars', () => {
    const chunks = chunkPages([{ pageNumber: 1, text: 'abcdefghij'.repeat(30) }], 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    const tail = chunks[0].text.slice(-20);
    expect(chunks[1].text.startsWith(tail)).toBe(true);
  });

  it('does not loop pathologically when overlapChars >= chunkSizeChars (degenerate config guard)', () => {
    const chunks = chunkPages([{ pageNumber: 1, text: 'a'.repeat(500) }], 100, 500);
    expect(chunks).toHaveLength(5);
  });

  it('normalizes CRLF so a Windows-authored PDF chunks identically to a Unix-authored one', () => {
    const crlf = chunkPages([{ pageNumber: 1, text: `${'a'.repeat(60)}\r\n\r\n${'b'.repeat(60)}` }], 70, 0);
    const lf = chunkPages([{ pageNumber: 1, text: `${'a'.repeat(60)}\n\n${'b'.repeat(60)}` }], 70, 0);
    expect(crlf.map((c) => c.text)).toEqual(lf.map((c) => c.text));
  });
});
