import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getQuestionReviewService } from '@/server/pdf-processing';
import { parseJsonBody, optionalInt, optionalString } from '@/server/common/http/validate';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import type { EditGeneratedQuestionInput } from '@/server/pdf-processing';

/** `PATCH /api/pdf-processing/questions/:id` — tenant-realm, requires `pdf.review` (FR-PDF-8: "full
 * text/option/answer/explanation editing... marks it as no longer purely auto-generated"). Every field
 * is optional, matching `EditGeneratedQuestionInput`'s own "patch just one field at a time" contract —
 * an all-absent body is a legitimate (if pointless) no-op-except-for-the-human-edited-flag, not a
 * validation error. `options`, if present, must be a plain object of string keys to string values
 * (never trusted verbatim from the client without a shape check). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'pdf.review');
    const { id } = await params;
    const body = await parseJsonBody(request);

    const patch: EditGeneratedQuestionInput = {
      questionText: optionalString(body.questionText, 'questionText', { max: 5000 }),
      options: validateOptionsField(body.options),
      correctAnswer: optionalString(body.correctAnswer, 'correctAnswer', { max: 10 }),
      explanation: body.explanation === undefined ? undefined : (body.explanation === null ? null : optionalString(body.explanation, 'explanation', { max: 5000 })),
      bloomsLevel: body.bloomsLevel === undefined ? undefined : (body.bloomsLevel === null ? null : optionalInt(body.bloomsLevel, 'bloomsLevel', { min: 1, max: 6 })),
      notes: body.notes === undefined ? undefined : (body.notes === null ? null : optionalString(body.notes, 'notes', { max: 1000 })),
    };

    const result = await getQuestionReviewService().editQuestion(id, patch);
    return NextResponse.json(result);
  });
}

/** `Record<string, string>` shape check — a caller-supplied `options` value that isn't a plain object
 * of string keys to string values fails loudly (`VALIDATION_FAILED`) rather than being persisted
 * verbatim into `generated_question.options_json`. */
function validateOptionsField(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationFailedError([{ field: 'options', constraint: 'options must be an object mapping option keys to option text.' }]);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, text] of entries) {
    if (typeof text !== 'string') {
      throw new ValidationFailedError([{ field: 'options', constraint: `options.${key} must be a string.` }]);
    }
  }
  return value as Record<string, string>;
}
