import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { requireFeatureLimit } from '@/server/platform/usage';
import { getEnv } from '@/server/config';
import { getPdfProcessingService, EmptyFileError, FileTooLargeError, type UploadedFileLike } from '@/server/pdf-processing';
import { optionalBoolean, optionalInt, optionalString, requireEnum } from '@/server/common/http/validate';

/** Generous fixed allowance (bytes) for multipart boundary/header overhead on top of the actual PDF
 * payload — same constant/rationale as `POST /api/exam-types/zip`'s own
 * `MULTIPART_OVERHEAD_ALLOWANCE_BYTES`. */
const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 65_536;

/** The three `contentTypeHint` values a caller may supply, matching the entity's own enum. */
const CONTENT_TYPE_HINTS = ['Lesson', 'Exam', 'Reference'] as const;

/**
 * `POST /api/pdf-processing/upload` — tenant-realm, requires `pdf.upload` — ported from
 * `legacy/api/src/modules/pdf-processing/api/pdf-processing.controller.ts`'s `upload`. FR-PDF-1: "the
 * session is created and an identifier returned to the caller (HTTP 202) *before* any AI work begins."
 *
 * Accepts `multipart/form-data`: a `file` field (the PDF) plus optional scalar fields
 * (`contentTypeHint`, `subjectId`, `curriculumId`, `forceReprocess`).
 *
 * **`pdf.generations` feature-usage limit** (FR-PKG-5): checked/incremented via `requireFeatureLimit`
 * immediately after the permission check, before the multipart body is even read — matches legacy's
 * `@RequiresFeature('pdf.generations')` guard order on `PdfProcessingController.upload`. Closes the gap
 * `POST /api/exam-types/zip`'s own identical, previously-documented pre-existing migration-plan gap
 * (`docs/plans/nextjs-rewrite-phase4-plan.md`'s "Decisions made") named, and Phase 10's own e2e
 * validation pass re-confirmed still open (see `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e
 * closure" section).
 *
 * **`Content-Length` pre-check before `request.formData()`**: mirrors `POST /api/exam-types/zip`'s own
 * documented real-defect fix (calling `request.formData()` on a meaningfully oversized body can throw a
 * raw 500 from inside Node's `undici` internals rather than the clean `413 FILE_TOO_LARGE` a post-parse
 * size check would produce).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.upload');
    await requireFeatureLimit(requireTenantId(), 'pdf.generations');

    const maxBytes = getEnv().MAX_PDF_SIZE_BYTES;
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes + MULTIPART_OVERHEAD_ALLOWANCE_BYTES) {
      throw new FileTooLargeError(maxBytes);
    }

    const formData = await request.formData();

    const contentTypeHintRaw = formData.get('contentTypeHint');
    const contentTypeHint =
      typeof contentTypeHintRaw === 'string' && contentTypeHintRaw.trim().length > 0
        ? requireEnum(contentTypeHintRaw, 'contentTypeHint', CONTENT_TYPE_HINTS)
        : undefined;
    const subjectId = optionalInt(coerceNumberField(formData.get('subjectId')), 'subjectId', { min: 1 });
    // `formData.get()` returns `null` (not `undefined`) for a field the client never sent —
    // `optionalString`/`optionalBoolean` only special-case `undefined` as "absent" (matching every
    // other optional-field consumer of these helpers, which all read from an already-parsed JSON body
    // where an absent key really is `undefined`). A real end-to-end HTTP run of this exact route
    // (this dispatch's own `phase6a-pdf-processing-routes.integration.test.ts`) caught this: omitting
    // `curriculumId`/`forceReprocess` entirely produced a raw `VALIDATION_FAILED` instead of the
    // expected 202, since `null` was passed straight through to `requireString`. Fixed by normalizing
    // `null` to `undefined` here, at the multipart-field-reading boundary, rather than changing
    // `optionalString`/`optionalBoolean`'s own contract (every other caller of those two helpers reads
    // from a JSON body, where this gap does not exist).
    const curriculumIdRaw = formData.get('curriculumId');
    const curriculumId = optionalString(typeof curriculumIdRaw === 'string' ? curriculumIdRaw : undefined, 'curriculumId', { min: 1, max: 36 });
    const forceReprocess = optionalBoolean(coerceBooleanField(formData.get('forceReprocess')), 'forceReprocess');

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new EmptyFileError();
    }
    if (file.size > maxBytes) {
      throw new FileTooLargeError(maxBytes);
    }

    const uploaded: UploadedFileLike = { originalName: file.name, buffer: Buffer.from(await file.arrayBuffer()) };
    const result = await getPdfProcessingService().uploadPdf({ contentTypeHint, subjectId, curriculumId, forceReprocess }, uploaded);
    return NextResponse.json(result, { status: 202 });
  });
}

/** `formData.get()` returns a string for every non-file field — `requireInt`/`optionalBoolean` expect
 * an actual `number`/`boolean`, so numeric/boolean-looking multipart fields are coerced here first,
 * matching `POST /api/exam-types/zip`'s own established `coerceNumberField` convention. */
function coerceNumberField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return Number(trimmed);
}

function coerceBooleanField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
