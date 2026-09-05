import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { requireFeatureLimit } from '@/server/platform/usage';
import { getEnv } from '@/server/config';
import { getExamAuthoringService, FileTooLargeError } from '@/server/exam-authoring';
import { InvalidZipStructureError } from '@/server/infrastructure/zip';
import { requireInt, requireString } from '@/server/common/http/validate';
import type { DeclaredModuleInput } from '@/server/exam-authoring';

/** Generous fixed allowance (bytes) for multipart boundary/header overhead on top of the actual ZIP
 * payload — a `multipart/form-data` body is always somewhat larger than the file it carries (field
 * name, boundary delimiters, `Content-Disposition`/`Content-Type` sub-headers). Same constant/rationale
 * as `POST /api/profile/picture`'s own `MULTIPART_OVERHEAD_ALLOWANCE_BYTES`. */
const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 65_536;

/**
 * `POST /api/exam-types/zip` — tenant-realm, requires `exams.create` — ported from
 * `legacy/api/src/modules/exam-authoring/api/exam-authoring.controller.ts`'s `createFromZip`. Accepts
 * `multipart/form-data`: a `file` field (the ZIP archive) plus JSON-encoded scalar/array fields
 * (`name`, `description?`, `totalQuestions`, `totalMinutes`, `stageId`, `modules` — the latter a
 * JSON-encoded array, per `CreateExamTypeDto`'s own documented "this codebase's first
 * multipart-request-with-a-nested-array DTO" precedent, adapted here to `request.formData()` since this
 * app has no `class-transformer`/`class-validator` equivalent).
 *
 * **`exams.create` feature-usage limit** (FR-PKG-5): checked/incremented via `requireFeatureLimit`
 * immediately after the permission check, before the multipart body is even read — matches legacy's
 * `@RequiresFeature('exams.create')` guard order on `ExamAuthoringController.createFromZip`. Closes the
 * gap `docs/plans/nextjs-rewrite-phase4-plan.md`'s "Decisions made" originally flagged and Phase 10's
 * own e2e validation pass re-confirmed still open (see `docs/plans/nextjs-rewrite-phase10-plan.md`'s
 * "Post-e2e closure" section).
 *
 * **`Content-Length` pre-check before `request.formData()`**: mirrors `POST /api/profile/picture`'s own
 * documented real-defect fix (calling `request.formData()` on a meaningfully oversized body can throw a
 * raw 500 from inside Node's `undici` internals rather than the clean `413 FILE_TOO_LARGE` a post-parse
 * size check would produce). A client omitting `Content-Length` still falls through to
 * `ExamAuthoringService`'s own ZIP-parsing path, which fails safely (a truncated/invalid archive is
 * `INVALID_ZIP_STRUCTURE`, never a partial write).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'exams.create');
    await requireFeatureLimit(requireTenantId(), 'exams.create');

    const maxBytes = getEnv().MAX_ZIP_SIZE_BYTES;
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes + MULTIPART_OVERHEAD_ALLOWANCE_BYTES) {
      throw new FileTooLargeError(maxBytes);
    }

    const formData = await request.formData();

    const name = requireString(formData.get('name'), 'name', { min: 1, max: 200 });
    const descriptionRaw = formData.get('description');
    const description =
      typeof descriptionRaw === 'string' && descriptionRaw.trim().length > 0
        ? requireString(descriptionRaw, 'description', { min: 1, max: 1000 })
        : undefined;
    const totalQuestions = requireInt(coerceNumberField(formData.get('totalQuestions')), 'totalQuestions', { min: 1 });
    const totalMinutes = requireInt(coerceNumberField(formData.get('totalMinutes')), 'totalMinutes', { min: 1 });
    const stageId = requireInt(coerceNumberField(formData.get('stageId')), 'stageId');
    const modules = parseDeclaredModules(formData.get('modules'));

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new InvalidZipStructureError('No ZIP file was uploaded.');
    }
    if (file.size > maxBytes) {
      throw new FileTooLargeError(maxBytes);
    }
    const zipBuffer = Buffer.from(await file.arrayBuffer());

    const created = await getExamAuthoringService().createFromZip(
      principal.userId,
      { name, description, totalQuestions, totalMinutes, stageId, modules },
      zipBuffer,
    );
    return NextResponse.json(created, { status: 201 });
  });
}

/** `formData.get()` returns a string for every non-file field — this app's numeric-field validation
 * helpers (`requireInt`) expect an actual `number`, so numeric-looking multipart fields are coerced
 * here first. A non-numeric string coerces to `NaN`, which `requireInt` then rejects with
 * `VALIDATION_FAILED` (never silently defaulting). */
function coerceNumberField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return Number(trimmed);
}

/**
 * Parses the `modules` multipart field from its JSON-string wire form into `DeclaredModuleInput[]`,
 * validating each entry's shape — the Route-Handler-level equivalent of legacy's
 * `CreateExamTypeDto.modules`' `@Transform` + `@ValidateNested` pair. An unparseable/non-array value
 * becomes an empty array rather than throwing here directly (matching legacy's own documented
 * behavior), so the caller's `ArrayMinSize(1)`-equivalent check (`ExamAuthoringService.createFromZip`'s
 * own `validateModuleCounts`) reports the standard `INVALID_ZIP_STRUCTURE`/`VALIDATION_FAILED` shape
 * instead of a raw JSON syntax error leaking through.
 *
 * @throws {import('@/server/common/errors/domain-error').ValidationFailedError} if any entry's
 *   `name`/`questionCount` fails its own field-level validation.
 */
function parseDeclaredModules(raw: FormDataEntryValue | null): DeclaredModuleInput[] {
  let parsedArray: unknown[] = [];
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      parsedArray = Array.isArray(parsed) ? parsed : [];
    } catch {
      parsedArray = [];
    }
  }

  return parsedArray.map((entry, index) => {
    const obj = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    return {
      name: requireString(obj.name, `modules[${index}].name`, { min: 1, max: 200 }),
      questionCount: requireInt(obj.questionCount, `modules[${index}].questionCount`, { min: 1 }),
    };
  });
}
