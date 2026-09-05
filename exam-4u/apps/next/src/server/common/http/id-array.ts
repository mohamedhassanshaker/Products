import { ValidationFailedError } from '@/server/common/errors/domain-error';

/** Largest `ids[]` this app accepts on any single bulk-action request body — a defensive upper bound
 * so a caller cannot force an unbounded in-memory/SQL `IN (...)` operation via one request. */
const MAX_IDS = 500;

/**
 * Validates a JSON body's `ids` field as an array of non-empty strings (FR-PDF-8/FR-PDF-10's shared
 * `{ids: string[]}` bulk-action/append shape). An empty array is explicitly ALLOWED through (never
 * rejected here) — every consumer of this helper (`QuestionReviewService.bulkDelete`/`bulkRegenerate`,
 * `AppendExamService.append`) treats an empty list as its own legitimate no-op, per FR-PDF-8's "empty
 * list -> 200 no-op" contract; rejecting it here would contradict that at the validation layer.
 */
export function requireStringIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationFailedError([{ field, constraint: `${field} must be an array of strings.` }]);
  }
  if (value.length > MAX_IDS) {
    throw new ValidationFailedError([{ field, constraint: `${field} must contain at most ${MAX_IDS} entries.` }]);
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new ValidationFailedError([{ field, constraint: `${field} must contain only non-empty strings.` }]);
    }
  }
  return value as string[];
}
