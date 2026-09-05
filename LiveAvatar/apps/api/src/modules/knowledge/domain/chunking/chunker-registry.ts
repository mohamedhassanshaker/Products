import { AppError } from '../../../../common/errors/app-error';
import type { ChunkingStrategy } from '../knowledge-source';
import type { ChunkerPort } from './chunker-port';
import { FixedSizeChunker } from './fixed-size-chunker';

/**
 * Resolves the `ChunkerPort` implementation for a `ChunkingStrategy`.
 * `semantic`/`heading_aware` throw defensively (BL-071 — real enum values,
 * not implemented this phase; same discipline as `assertParserSupported`).
 * @param strategy - Source's declared chunking strategy
 * @throws AppError 400 KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED
 */
export function resolveChunker(strategy: ChunkingStrategy): ChunkerPort {
  if (strategy === 'fixed') {
    return new FixedSizeChunker();
  }
  throw AppError.badRequest('KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED');
}
