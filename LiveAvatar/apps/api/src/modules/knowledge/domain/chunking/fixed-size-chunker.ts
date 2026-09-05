import type { ChunkerOptions, ChunkerPort, ChunkResult } from './chunker-port';

/**
 * Fixed-size sliding-window chunker (Phase 12a — the only `ChunkingStrategy`
 * implemented this phase). Pure domain: no I/O, no NestJS decorators.
 */
export class FixedSizeChunker implements ChunkerPort {
  readonly strategy = 'fixed' as const;

  /**
   * @param text - Cleaned source text (see `parsing/parse-content.ts`)
   * @param options - `chunkSize`/`chunkOverlap`, already validated by `assertChunkOverlapValid`
   * @throws Error when `chunkSize` is not positive or `chunkOverlap` is out of `[0, chunkSize)`
   */
  chunk(text: string, { chunkSize, chunkOverlap }: ChunkerOptions): ChunkResult[] {
    if (chunkSize <= 0) {
      throw new Error('chunkSize must be positive');
    }
    if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
      throw new Error('chunkOverlap must be >= 0 and < chunkSize');
    }
    if (text.length === 0) {
      return [];
    }
    const step = chunkSize - chunkOverlap;
    const chunks: ChunkResult[] = [];
    let start = 0;
    let index = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push({ index, text: text.slice(start, end), charStart: start, charEnd: end });
      index += 1;
      if (end === text.length) {
        break;
      }
      start += step;
    }
    return chunks;
  }
}
