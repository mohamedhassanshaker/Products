export { parseExamZip } from './exam-zip-parser';
export type { ParsedExamModule, ParsedExamQuestion, ParsedExamZip } from './exam-zip-parser';
export { EmptyModuleError, InvalidQuestionFileError, InvalidZipStructureError } from './errors';

/**
 * `server/infrastructure/zip`'s public barrel (Phase 4) — exam-authoring ZIP archive parsing/validation
 * (FR-AUTH-1), fully self-contained (no dependency on `server/exam-authoring` or any other module).
 * Nothing outside this module may import `./exam-zip-parser`/`./errors` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `infrastructure/zip` module-boundary rule).
 */
