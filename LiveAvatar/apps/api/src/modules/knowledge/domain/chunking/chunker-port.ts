/** One chunk produced by a `ChunkerPort` implementation. */
export interface ChunkResult {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
}

/** Options every `ChunkerPort` implementation accepts. */
export interface ChunkerOptions {
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Pure, framework-free text-chunking strategy (Phase 12a, BL-071 shapes this
 * so `semantic`/`heading_aware` implementations are additive later — neither
 * is built this phase).
 */
export interface ChunkerPort {
  readonly strategy: 'fixed' | 'semantic' | 'heading_aware';
  chunk(text: string, options: ChunkerOptions): ChunkResult[];
}
