import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getExamAuthoringService } from '@/server/exam-authoring';

/**
 * `POST /api/exam-types/:id/fix-subject-mapping` — tenant-realm, requires `exams.remap_subjects`
 * (already seeded by Phase 1's `SeedRbacStep`, no new permission needed). Ported from
 * `legacy/api/src/modules/exam-authoring/api/exam-authoring.controller.ts`'s `fixSubjectMapping`
 * (LLD §7.5, FR-AUTH-6) — the real wiring Phase 4 deferred, now closed (migration plan Phase 6,
 * sub-slice "6b").
 *
 * **`exams.remap_subjects`, deliberately distinct from `exams.update`/`exams.delete`** (legacy's own
 * choice, ported verbatim): re-mapping neither edits the Exam Type's declared configuration nor
 * destroys anything, so it is its own separately-grantable capability.
 *
 * **`202`, not `200`** — matches legacy's convention for an endpoint whose response is a same-request
 * summary of AI-backed work rather than a synchronous CRUD result. Nothing is created, so `202
 * Accepted` best names "the re-mapping pass ran, here's what it did".
 *
 * **Idempotent by construction** — the underlying `SubjectClassificationService` only ever targets rows
 * where `subject_id IS NULL`, so a second call against an already-fully-resolved Exam Type examines 0
 * rows and issues no AI call at all.
 *
 * **No request body at all** — the Exam Type id in the path is the entire input, so there is nothing
 * further to validate beyond the RBAC gate and the service's own existence check
 * (`EXAM_TYPE_NOT_FOUND`).
 *
 * **Rate limiting**: this app has no rate-limiting middleware anywhere yet (a pre-existing,
 * migration-plan-wide gap, not one this sub-slice introduced) — flagged explicitly here per this
 * dispatch's own security instruction, since this is an AI-calling endpoint. The practical bound today
 * is the idempotency above (a repeat call over already-mapped content makes no AI call) plus the
 * `exams.remap_subjects` permission gate.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'exams.remap_subjects');
    const { id } = await params;
    const result = await getExamAuthoringService().fixSubjectMapping(principal.userId, id);
    return NextResponse.json(result, { status: 202 });
  });
}
