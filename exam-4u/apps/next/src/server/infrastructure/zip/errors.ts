import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `infrastructure/zip`-module `DomainError` subclasses — ported from
 * `legacy/api/src/modules/exam-authoring/domain/errors.ts`'s ZIP-structural subset (the remaining
 * exam-authoring-specific errors — `QUESTION_COUNT_MISMATCH`/`EXAM_TYPE_NAME_EXISTS`/
 * `EXAM_TYPE_NOT_FOUND`/`EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` — live in `server/exam-authoring/domain/errors.ts`
 * instead).
 *
 * **Placement judgment call** (LLD silent on exactly which module owns these three classes): legacy
 * co-locates every exam-authoring-related `DomainError` in one file even though `exam-zip-parser.ts`
 * itself lives outside `modules/exam-authoring` entirely (at top-level `infrastructure/zip`). This app's
 * plain-TypeScript module-boundary rule makes that cross-module reach-through impossible without
 * creating a circular barrel dependency (`infrastructure/zip` needing `exam-authoring`'s barrel for
 * error types, while `exam-authoring` needs `infrastructure/zip`'s barrel for `parseExamZip`). Since
 * these three errors describe the ZIP archive's own structure/content shape — not an Exam Type business
 * rule — the smallest-reasonable choice is co-locating them with the parser that actually throws them,
 * keeping `infrastructure/zip` a fully self-contained, one-way dependency of `exam-authoring` (never the
 * reverse). Every `ErrorCode` used here already exists in `@examland/contracts`'s catalog.
 */

/** FR-AUTH-1: malformed ZIP structure — not a real ZIP, an entry with an unsafe/unexpected path
 * (including a zip-slip attempt), or an archive with no module folders at all. `detail` is a
 * safe-to-display, non-sensitive description (never a raw filesystem path). */
export class InvalidZipStructureError extends DomainError {
  constructor(detail: string) {
    super('INVALID_ZIP_STRUCTURE', detail);
  }
}

/** FR-AUTH-1: "a `.json` question file missing a required field -> `INVALID_QUESTION_FILE` naming the
 * file and field." `filePath` is the `moduleName/fileName.json` path exactly as it appeared in the
 * archive (already proven safe by `assertSafeEntryName` before this error can be constructed). */
export class InvalidQuestionFileError extends DomainError {
  constructor(filePath: string, field: string, reason: string) {
    super('INVALID_QUESTION_FILE', `"${filePath}": field "${field}" ${reason}.`, { file: filePath, field });
  }
}

/** FR-AUTH-1: "a module folder with zero valid questions -> `EMPTY_MODULE` naming the module." */
export class EmptyModuleError extends DomainError {
  constructor(moduleName: string) {
    super('EMPTY_MODULE', `Module "${moduleName}" contains no valid question files.`, { module: moduleName });
  }
}
