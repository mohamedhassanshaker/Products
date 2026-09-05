import yauzl from 'yauzl';
import { resolve as resolvePath, sep as pathSep } from 'node:path';
import { DomainError, InternalDomainError } from '@/server/common/errors/domain-error';
import { isZipMagicBytes } from '@/server/common/util/zip-signature.util';
import { EmptyModuleError, InvalidQuestionFileError, InvalidZipStructureError } from './errors';

/** One parsed multiple-choice question extracted from a `.json` file inside a module folder
 * (FR-AUTH-1: "each represent one multiple-choice question (text, options, correct answer,
 * explanation)"). `sourceFileName` is kept for `question_key` derivation and for error messages
 * pointing back at the offending file. `rawJson` is the exact bytes originally uploaded — persisted
 * verbatim to `StoragePort` (never re-serialized), so what a manager downloads back out is
 * byte-identical to what they uploaded. */
export interface ParsedExamQuestion {
  moduleName: string;
  sourceFileName: string;
  rawJson: Buffer;
  text: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string | null;
}

/** One top-level ZIP folder (FR-AUTH-1: "top-level folders represent subjects/modules"), with the
 * questions found directly inside it. */
export interface ParsedExamModule {
  moduleName: string;
  questions: ParsedExamQuestion[];
}

/** The fully-validated result of parsing an authoring ZIP — every module has at least one valid
 * question, every question has every required field. Nothing in this shape can produce a partial or
 * inconsistent `ExamType` once persisted. */
export interface ParsedExamZip {
  modules: ParsedExamModule[];
}

/**
 * Parses and validates an exam-authoring ZIP archive (FR-AUTH-1) entirely in memory — ported logic
 * (not code) from `legacy/api/src/infrastructure/zip/exam-zip-parser.ts`. No filesystem write happens
 * here; the caller (`ExamAuthoringService`) only writes to `StoragePort` once this function has
 * returned a fully-valid result, which is what keeps "any validation failure leaves no storage
 * artifacts" trivially true for every failure this function can raise.
 *
 * **Zip-slip defense (security-critical)**: every entry's raw name is checked by
 * {@link assertSafeEntryName} *before* it is treated as a module/file path anywhere in this function —
 * an entry naming a path that would traverse outside the intended two-level `moduleName/fileName.json`
 * shape (`../`, a leading `/` or drive letter, backslash-separated traversal, embedded NUL bytes) is
 * rejected with `INVALID_ZIP_STRUCTURE` regardless of whether the rest of the archive is otherwise
 * perfectly valid. This is deliberately **not** solely relying on `yauzl`'s own `validateFileName`
 * (which only recognizes forward-slash-separated POSIX-style traversal) — this function additionally
 * normalizes backslashes and independently re-derives the two path segments, so a payload crafted
 * specifically to slip past one library's assumptions is still caught by the other check.
 *
 * @param buffer The raw uploaded file bytes.
 * @throws {InvalidZipStructureError} if the buffer is not a well-formed ZIP, an entry's path is unsafe
 *   or does not match the required `moduleName/fileName.json` two-level shape, or the archive contains
 *   no modules at all.
 * @throws {EmptyModuleError} if a top-level folder contains zero valid `.json` question files.
 * @throws {InvalidQuestionFileError} if a `.json` file is malformed or missing a required field.
 */
export async function parseExamZip(buffer: Buffer): Promise<ParsedExamZip> {
  if (!isZipMagicBytes(buffer)) {
    throw new InvalidZipStructureError('The uploaded file is not a valid ZIP archive.');
  }

  const zipFile = await openZip(buffer);
  const modulesByName = new Map<string, ParsedExamQuestion[]>();
  // Preserves first-seen order for deterministic, human-readable error messages / module listing.
  const moduleOrder: string[] = [];

  try {
    await forEachEntry(zipFile, async (entry) => {
      if (isDirectoryEntry(entry.fileName)) {
        // A top-level directory entry (`moduleName/`) registers that module even if it turns out to
        // contain zero valid question files — this is what lets `EMPTY_MODULE` distinguish "a real,
        // named module folder with nothing valid in it" from "this name never appeared in the archive
        // at all" (some zip tools omit explicit directory entries entirely, in which case a module
        // with zero files is indistinguishable from an absent one — an accepted limitation of relying
        // on the archive's own directory entries).
        const segments = assertSafeEntryName(entry.fileName);
        if (segments.length === 1 && !modulesByName.has(segments[0])) {
          modulesByName.set(segments[0], []);
          moduleOrder.push(segments[0]);
        }
        return;
      }
      if (isIgnorableJunkEntry(entry.fileName)) return; // e.g. __MACOSX/, .DS_Store

      const segments = assertSafeEntryName(entry.fileName);
      // Required shape: exactly `moduleName/fileName.json` (two segments, both non-empty).
      if (segments.length !== 2 || !segments[1].toLowerCase().endsWith('.json')) {
        throw new InvalidZipStructureError(
          `Unexpected entry "${entry.fileName}" — every file must sit directly inside a single top-level module folder and be a ".json" question file.`,
        );
      }
      const [moduleName, fileName] = segments;

      const contentBuffer = await readEntry(zipFile, entry);
      const question = parseQuestionFile(moduleName, fileName, contentBuffer);

      if (!modulesByName.has(moduleName)) {
        modulesByName.set(moduleName, []);
        moduleOrder.push(moduleName);
      }
      modulesByName.get(moduleName)!.push(question);
    });
  } finally {
    zipFile.close();
  }

  if (moduleOrder.length === 0) {
    throw new InvalidZipStructureError('The ZIP archive contains no module folders.');
  }

  const modules: ParsedExamModule[] = moduleOrder.map((moduleName) => {
    const questions = modulesByName.get(moduleName)!;
    if (questions.length === 0) {
      throw new EmptyModuleError(moduleName);
    }
    return { moduleName, questions };
  });

  return { modules };
}

/** True for a yauzl entry name that denotes a directory (trailing `/`), which carries no content. */
function isDirectoryEntry(fileName: string): boolean {
  return fileName.endsWith('/');
}

/** Entries this parser silently ignores rather than treating as a structural error — common,
 * harmless artifacts a real-world zip tool (macOS Finder, Windows Explorer) adds that are not part of
 * the exam-manager's actual authored content. */
function isIgnorableJunkEntry(fileName: string): boolean {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  return fileName.startsWith('__MACOSX/') || base === '.DS_Store' || base === 'Thumbs.db';
}

/**
 * The zip-slip barrier. Rejects any entry name that could resolve outside the two-level
 * `moduleName/fileName` shape this format requires, independent of `yauzl`'s own validation.
 *
 * @param rawName The entry's name exactly as recorded in the ZIP's central directory.
 * @returns The path split into segments (e.g. `['module1', 'q1.json']`) once proven safe.
 * @throws {InvalidZipStructureError} if the name contains a NUL byte, is empty, is absolute (leading
 *   `/` or `\`, or a drive letter like `C:`), or contains a `.`/`..` path segment anywhere.
 */
function assertSafeEntryName(rawName: string): string[] {
  if (rawName.length === 0 || rawName.includes('\0')) {
    throw new InvalidZipStructureError(`Unsafe entry name in ZIP archive.`);
  }
  // Normalize both separator styles before splitting — a payload could use either, and this format
  // never legitimately needs backslashes in a path, so treating them identically to `/` only ever
  // narrows what is accepted, never widens it.
  const normalized = rawName.replace(/\\/g, '/');

  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new InvalidZipStructureError(`Entry "${rawName}" uses an absolute path, which is not permitted.`);
  }

  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new InvalidZipStructureError(`Entry "${rawName}" contains a path-traversal segment, which is not permitted.`);
  }

  // Defense-in-depth re-derivation (mirrors `LocalDiskStorageAdapter.resolveSafe`'s own
  // normalize+resolve+assert-still-under-root pattern): reconstruct the path against a fixed,
  // arbitrary root and assert the resolved absolute path never leaves it. Segment-level rejection
  // above already makes this unreachable for any input that passed it, but this keeps the guarantee
  // structural rather than resting entirely on the segment scan never having a gap.
  const root = resolvePath('/__examland_zip_root__');
  const resolved = resolvePath(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + pathSep)) {
    throw new InvalidZipStructureError(`Entry "${rawName}" resolves outside the archive root, which is not permitted.`);
  }

  return segments;
}

/** Parses and field-validates one question `.json` file's content (FR-AUTH-1: "text, options, correct
 * answer, explanation"). Required fields: `text` (non-empty string), `options` (an object with at
 * least two string-valued keys), `correctAnswer` (a string naming one of `options`'s keys).
 * `explanation` is optional. These field names/shape match the LLD's own DDL column names
 * (`question_text`, `options_json`, `correct_answer`, `explanation`) one-to-one.
 *
 * @throws {InvalidQuestionFileError} naming the offending file and the specific missing/invalid field.
 */
function parseQuestionFile(moduleName: string, fileName: string, buffer: Buffer): ParsedExamQuestion {
  const path = `${moduleName}/${fileName}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new InvalidQuestionFileError(path, 'body', 'must be valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidQuestionFileError(path, 'body', 'must be a JSON object');
  }
  const body = parsed as Record<string, unknown>;

  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    throw new InvalidQuestionFileError(path, 'text', 'is required and must be a non-empty string');
  }

  if (
    typeof body.options !== 'object' ||
    body.options === null ||
    Array.isArray(body.options) ||
    Object.keys(body.options as object).length < 2
  ) {
    throw new InvalidQuestionFileError(path, 'options', 'is required and must be an object with at least two choices');
  }
  const options = body.options as Record<string, unknown>;
  for (const [key, value] of Object.entries(options)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidQuestionFileError(path, `options.${key}`, 'must be a non-empty string');
    }
  }

  if (typeof body.correctAnswer !== 'string' || !(body.correctAnswer in options)) {
    throw new InvalidQuestionFileError(path, 'correctAnswer', 'is required and must name one of the keys in "options"');
  }

  if (body.explanation !== undefined && body.explanation !== null && typeof body.explanation !== 'string') {
    throw new InvalidQuestionFileError(path, 'explanation', 'must be a string when present');
  }

  return {
    moduleName,
    sourceFileName: fileName,
    rawJson: buffer,
    text: body.text,
    options: options as Record<string, string>,
    correctAnswer: body.correctAnswer,
    explanation: (body.explanation as string | undefined) ?? null,
  };
}

// ── yauzl promise-wrapping helpers ──────────────────────────────────────────
// `yauzl`'s own promise API (`fromBufferPromise`) always opens with the default `autoClose: false`/
// lazy-entries-disabled behavior; wrapping it explicitly here keeps this file's control flow
// (validate-then-read, one entry at a time, no double-firing of the `entry` event) obvious and
// independently testable, rather than depending on exactly which yauzl option combination happens to
// produce it.

async function openZip(buffer: Buffer): Promise<import('yauzl').ZipFile> {
  try {
    return await yauzl.fromBufferPromise(buffer, { lazyEntries: true, validateEntrySizes: true });
  } catch {
    throw new InvalidZipStructureError('The uploaded file is not a valid ZIP archive.');
  }
}

/** Iterates every entry in `zipFile` sequentially (`lazyEntries: true` — the next entry is only
 * requested once `handler` for the current one has fully resolved), so `handler` can safely perform
 * async work (like `readEntry`) per entry without racing yauzl's own event loop. */
function forEachEntry(
  zipFile: import('yauzl').ZipFile,
  handler: (entry: import('yauzl').Entry) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (err instanceof DomainError) {
        reject(err);
        return;
      }
      // `yauzl` performs its own entry-name validation (e.g. rejecting `../`-relative and absolute
      // paths — see its `validateFileName`) and emits a plain `Error` via the `'error'` event for any
      // such rejection *before* the offending entry ever reaches this module's own `entry` handler /
      // `assertSafeEntryName` check. This is a genuine second, independent layer of zip-slip defense
      // (this module's own `assertSafeEntryName` does not rely on it — see that function's doc
      // comment — but a real archive can trip yauzl's check first), and any such failure is a
      // structural problem with the archive from this API's point of view, so it is translated to
      // `INVALID_ZIP_STRUCTURE` rather than leaking as a raw, unclassified `Error`.
      reject(new InvalidZipStructureError('The ZIP archive is malformed or contains an unsafe entry name.'));
    };

    zipFile.on('error', fail);
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zipFile.on('entry', (entry: import('yauzl').Entry) => {
      handler(entry)
        .then(() => {
          if (!settled) zipFile.readEntry();
        })
        .catch(fail);
    });
    zipFile.readEntry();
  });
}

/** Reads one entry's full content into a `Buffer`. Exam-authoring `.json` question files are small (a
 * single question each) — buffering in memory is deliberate and matches this codebase's existing
 * `Buffer`-based upload convention (`ProfileService.uploadPicture`), not a scalability concern for this
 * format. */
function readEntry(zipFile: import('yauzl').ZipFile, entry: import('yauzl').Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new InvalidZipStructureError(`Could not read entry "${entry.fileName}" from the ZIP archive.`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (streamErr) => reject(new InternalDomainError(streamErr)));
    });
  });
}
