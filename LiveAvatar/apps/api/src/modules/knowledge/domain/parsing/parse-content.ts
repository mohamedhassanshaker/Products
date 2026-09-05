import { AppError } from '../../../../common/errors/app-error';
import type { KnowledgeSourceParser } from '../knowledge-source';

/**
 * Decodes raw uploaded bytes to text per the source's declared parser.
 * `pdf` is unreachable via the validated create/update path
 * (`assertParserSupported` rejects it before a source can be saved with it)
 * — this throws defensively rather than silently mis-decoding binary PDF
 * bytes as UTF-8 (PDF parsing is out of scope this phase).
 * @param rawContent - The source's stored upload bytes
 * @param parser - The source's declared parser
 * @throws AppError 400 KNOWLEDGE_PARSER_NOT_SUPPORTED for `pdf`
 */
export function parseContent(rawContent: Buffer, parser: KnowledgeSourceParser): string {
  if (parser === 'plain_text' || parser === 'markdown') {
    return rawContent.toString('utf-8');
  }
  throw AppError.badRequest('KNOWLEDGE_PARSER_NOT_SUPPORTED');
}

/**
 * Normalizes text before chunking: CRLF/CR line endings become LF, 3-or-more
 * consecutive blank lines collapse to exactly one blank line, and
 * leading/trailing whitespace is trimmed. No markdown-specific stripping is
 * performed — markdown is chunked as literal text this phase, not rendered
 * or cleaned of syntax.
 * @param text - Raw decoded text
 */
export function cleanText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // N blank lines between two content lines are N+1 consecutive "\n"
  // characters, so "3+ blank lines" is 4-or-more consecutive newlines;
  // collapsing to "\n\n" leaves exactly one blank line at that point while
  // leaving a single existing blank line (2 newlines) untouched.
  const collapsed = normalized.replace(/\n{4,}/g, '\n\n');
  return collapsed.trim();
}
