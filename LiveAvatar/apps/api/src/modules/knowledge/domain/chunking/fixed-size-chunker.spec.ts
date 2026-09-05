import { FixedSizeChunker } from './fixed-size-chunker';

describe('FixedSizeChunker', () => {
  const chunker = new FixedSizeChunker();

  function assertSlicesMatch(text: string, chunks: ReturnType<FixedSizeChunker['chunk']>) {
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  }

  it('returns [] for an empty string', () => {
    expect(chunker.chunk('', { chunkSize: 10, chunkOverlap: 0 })).toEqual([]);
  });

  it('returns exactly one chunk covering all of a text shorter than chunkSize', () => {
    const text = 'short text';
    const chunks = chunker.chunk(text, { chunkSize: 100, chunkOverlap: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ index: 0, text, charStart: 0, charEnd: text.length });
  });

  it('splits text exactly N x chunkSize with 0 overlap into N contiguous non-overlapping chunks reconstructing the original', () => {
    const text = 'a'.repeat(10) + 'b'.repeat(10) + 'c'.repeat(10);
    const chunks = chunker.chunk(text, { chunkSize: 10, chunkOverlap: 0 });
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.text)).toEqual(['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)]);
    expect(chunks.map((c) => c.charStart)).toEqual([0, 10, 20]);
    expect(chunks.map((c) => c.charEnd)).toEqual([10, 20, 30]);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    assertSlicesMatch(text, chunks);
  });

  it('produces overlapping chunks that share the expected overlapping substring, advancing by step = chunkSize - chunkOverlap', () => {
    const text = '0123456789'; // 10 chars
    const chunks = chunker.chunk(text, { chunkSize: 4, chunkOverlap: 2 });
    // step = 2: starts at 0, 2, 4, 6 — the loop stops as soon as a chunk's
    // end reaches text.length (10), which the start=6 chunk (end=10) does,
    // so start=8 is never emitted as its own chunk.
    expect(chunks.map((c) => c.charStart)).toEqual([0, 2, 4, 6]);
    expect(chunks.map((c) => c.text)).toEqual(['0123', '2345', '4567', '6789']);
    // Consecutive chunks share the overlapping substring.
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const cur = chunks[i];
      const overlapLen = prev.charEnd - cur.charStart;
      if (overlapLen > 0) {
        expect(prev.text.slice(prev.text.length - overlapLen)).toBe(cur.text.slice(0, overlapLen));
      }
    }
    assertSlicesMatch(text, chunks);
  });

  it('includes a final chunk shorter than chunkSize when the text is not evenly divisible', () => {
    const text = 'a'.repeat(25);
    const chunks = chunker.chunk(text, { chunkSize: 10, chunkOverlap: 0 });
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toMatchObject({ charStart: 20, charEnd: 25, text: 'a'.repeat(5) });
    assertSlicesMatch(text, chunks);
  });

  it('every chunk satisfies text.slice(charStart, charEnd) === chunk.text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
    const chunks = chunker.chunk(text, { chunkSize: 37, chunkOverlap: 11 });
    assertSlicesMatch(text, chunks);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('throws when chunkOverlap >= chunkSize', () => {
    expect(() => chunker.chunk('hello', { chunkSize: 5, chunkOverlap: 5 })).toThrow(
      'chunkOverlap must be >= 0 and < chunkSize',
    );
    expect(() => chunker.chunk('hello', { chunkSize: 5, chunkOverlap: 6 })).toThrow();
  });

  it('throws when chunkOverlap is negative', () => {
    expect(() => chunker.chunk('hello', { chunkSize: 5, chunkOverlap: -1 })).toThrow();
  });

  it('throws when chunkSize <= 0', () => {
    expect(() => chunker.chunk('hello', { chunkSize: 0, chunkOverlap: 0 })).toThrow('chunkSize must be positive');
    expect(() => chunker.chunk('hello', { chunkSize: -5, chunkOverlap: 0 })).toThrow();
  });

  it('exposes its strategy literal', () => {
    expect(chunker.strategy).toBe('fixed');
  });
});
