import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getAppendExamService } from '@/server/pdf-processing';
import type { AppendExamInput } from '@/server/pdf-processing';
import { parseJsonBody, requireString } from '@/server/common/http/validate';
import { requireStringIdArray } from '@/server/common/http/id-array';

/** `POST /api/pdf-processing/sessions/:id/append` — tenant-realm, requires `exams.finalize` (FR-PDF-10,
 * LLD §7.6, migration plan Phase 6, sub-slice "6c") — the same permission `POST .../finalize` uses (LLD
 * §7.6 names no separate permission for append, and both actions extend the same live Exam Type
 * content). `200` (an existing Exam Type was extended, nothing new created), matching legacy's
 * `HttpStatus.OK`.
 *
 * **`Idempotency-Key` (optional header, LLD §7.6: "`+ Idempotency-Key` header (P1)")** — see
 * `AppendExamService`'s class doc comment for the full two-layer idempotency design when it is present,
 * and the still-safe (content-level-only) guard when it is omitted.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'exams.finalize');
    const { id } = await params;
    const body = await parseJsonBody(request);

    const input: AppendExamInput = {
      examTypeId: requireString(body.examTypeId, 'examTypeId', { min: 1, max: 36 }),
      ids: requireStringIdArray(body.ids, 'ids'),
    };
    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;

    const result = await getAppendExamService().append(id, input, idempotencyKey);
    return NextResponse.json(result, { status: 200 });
  });
}
