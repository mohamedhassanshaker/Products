import { AppError } from '../../../common/errors/app-error';
import type { ChunkingStrategy, KnowledgeSourceParser } from './knowledge-source';

/** Upload cap (Phase 12a plan doc "Decisions made this phase" #4) — bytea in Postgres, not disk/object storage. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Real MIME types accepted for a text/markdown upload. Browsers/curl are inconsistent about markdown's MIME type. */
const ALLOWED_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);

/** Extension fallback for markdown/text uploads sent with an unhelpful/absent MIME type. */
const ALLOWED_EXTENSIONS = ['.txt', '.md'];

/** Only the OpenAI `text-embedding-3-small` model is selectable this phase (plan doc decision #1 — fixes the pgvector column width). */
const SUPPORTED_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * @param name - Candidate source name
 * @returns Trimmed name
 * @throws AppError 400 KNOWLEDGE_SOURCE_NAME_REQUIRED when empty/too long
 */
export function assertSourceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 160) {
    throw AppError.badRequest('KNOWLEDGE_SOURCE_NAME_REQUIRED');
  }
  return trimmed;
}

/**
 * Real values only (`plain_text`/`markdown`) — `pdf` is a real enum value
 * not implemented this phase (plan doc decision #5). Defense-in-depth
 * backstop: the admin UI never offers it, but the API must still reject it.
 * @param parser - Candidate parser
 * @throws AppError 400 KNOWLEDGE_PARSER_NOT_SUPPORTED
 */
export function assertParserSupported(parser: KnowledgeSourceParser): void {
  if (parser !== 'plain_text' && parser !== 'markdown') {
    throw AppError.badRequest('KNOWLEDGE_PARSER_NOT_SUPPORTED');
  }
}

/**
 * Only `fixed` is implemented this phase (BL-071 — `semantic`/`heading_aware`
 * stay real-but-disabled enum values so the schema doesn't need to change
 * when they ship).
 * @param strategy - Candidate chunking strategy
 * @throws AppError 400 KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED
 */
export function assertChunkingStrategySupported(strategy: ChunkingStrategy): void {
  if (strategy !== 'fixed') {
    throw AppError.badRequest('KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED');
  }
}

/**
 * @param model - Candidate embedding model name
 * @throws AppError 400 KNOWLEDGE_EMBEDDING_MODEL_NOT_SUPPORTED
 */
export function assertEmbeddingModelSupported(model: string): void {
  if (model !== SUPPORTED_EMBEDDING_MODEL) {
    throw AppError.badRequest('KNOWLEDGE_EMBEDDING_MODEL_NOT_SUPPORTED');
  }
}

/**
 * @param chunkSize - Candidate resulting chunk_size
 * @param chunkOverlap - Candidate resulting chunk_overlap
 * @throws AppError 400 KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID unless `0 <= chunkOverlap < chunkSize`
 */
export function assertChunkOverlapValid(chunkSize: number, chunkOverlap: number): void {
  if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw AppError.badRequest('KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID');
  }
}

/** The subset of a multer file this module needs — decoupled from `Express.Multer.File`. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Validates an uploaded file's presence, size, and type. Not a security
 * boundary by itself (this is a UX-quality classification gate — the
 * uploaded bytes are stored as Postgres `Bytes`, never written to a
 * filesystem path derived from `originalname`, so there is no path-traversal
 * surface here regardless).
 * @param file - The multer in-memory file, if one was sent
 * @throws AppError 400 KNOWLEDGE_SOURCE_FILE_MISSING when absent
 * @throws AppError 400 KNOWLEDGE_SOURCE_FILE_TOO_LARGE when over 10 MiB
 * @throws AppError 400 KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED unless plain-text/markdown
 */
export function assertUploadFile(file: UploadedFile | undefined): UploadedFile {
  if (!file) {
    throw AppError.badRequest('KNOWLEDGE_SOURCE_FILE_MISSING');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw AppError.badRequest('KNOWLEDGE_SOURCE_FILE_TOO_LARGE');
  }
  const lowerName = file.originalname.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) && !hasAllowedExtension) {
    throw AppError.badRequest('KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED');
  }
  return file;
}
