import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { requireFeatureLimit } from '@/server/platform/usage';
import { getEnv } from '@/server/config';
import { getCurriculumDocumentsService, NoExtractableTextError } from '@/server/curricula';
import { requireString } from '@/server/common/http/validate';

/** Generous fixed allowance (bytes) for multipart boundary/header overhead on top of the actual PDF
 * payload — same constant/rationale as `POST /api/exam-types/zip` and `POST /api/pdf-processing/upload`. */
const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 65_536;

/**
 * `GET /api/curricula/:id/documents` — tenant-realm, requires `curricula.manage_own`. Lists the
 * documents already indexed into a Curriculum (ownership/oversight enforced inside the service, not
 * here — HLD §5.2).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    const { id } = await params;
    const documents = await getCurriculumDocumentsService().listDocuments(principal.userId, id);
    return NextResponse.json(documents);
  });
}

/**
 * `POST /api/curricula/:id/documents` — tenant-realm, requires `curricula.manage_own` — FR-CUR-2's
 * Curriculum document ingestion (migration plan Phase 6, sub-slice "6b", **closing Phase 3's own
 * documented deferral**). Accepts `multipart/form-data` with a single `file` field (a PDF).
 *
 * Adapted from `legacy/api/src/modules/curricula/api/curricula.controller.ts`'s `uploadDocuments`,
 * narrowed to ONE file per request rather than legacy's array — a per-file success/failure result array
 * only exists to serve a multi-file upload widget, and this app has no such client; one file per
 * request keeps the response an ordinary resource-created shape whose failures are ordinary HTTP
 * errors. Multi-file upload is a purely additive client-side loop over this same endpoint if a later
 * sub-slice wants it.
 *
 * **Synchronous, unlike `POST /api/pdf-processing/upload`'s 202-then-background pipeline** — and
 * deliberately so: FR-PDF-1's "202 before any AI work" requirement exists because that pipeline makes
 * many expensive *generation* calls. Ingestion here makes no generation call at all — just extraction
 * plus one batched embedding call — so the caller gets the real `chunkCount` back and knows the
 * document is genuinely searchable, rather than having to poll for a status this endpoint has no
 * mechanism to report. Bounded by `MAX_PDF_SIZE_BYTES` exactly as the pipeline upload is.
 *
 * **`Content-Length` pre-check before `request.formData()`**: mirrors the established fix elsewhere in
 * this app (calling `request.formData()` on a meaningfully oversized body can throw a raw 500 from
 * inside Node's `undici` internals rather than a clean 4xx).
 *
 * **Rate limiting**: none — this app has no rate-limiting middleware anywhere yet (a pre-existing
 * migration-plan-wide gap, flagged explicitly here since this endpoint spends real embedding budget).
 * The `curricula.manage_own` gate, the ownership check inside the service, and `MAX_PDF_SIZE_BYTES`
 * are the bounds that do exist today.
 *
 * **`curricula.documents` feature-usage limit** (FR-PKG-5, closing the gap Phase 10's own e2e
 * validation pass flagged — see `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e closure"
 * section): checked/incremented via `requireFeatureLimit` immediately after the permission check,
 * before the multipart body is even read — matches legacy's `@RequiresFeature('curricula.documents')`
 * guard order on `CurriculaController.uploadDocuments`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'curricula.manage_own');
    await requireFeatureLimit(requireTenantId(), 'curricula.documents');
    const { id } = await params;

    const maxBytes = getEnv().MAX_PDF_SIZE_BYTES;
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes + MULTIPART_OVERHEAD_ALLOWANCE_BYTES) {
      throw new NoExtractableTextError();
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > maxBytes) {
      throw new NoExtractableTextError();
    }
    // Validated purely as data (recorded on the row, never used as a storage-path segment) — the
    // storage key is built entirely from server-derived values inside the service.
    const originalName = requireString(file.name, 'file.name', { min: 1, max: 255 });

    const document = await getCurriculumDocumentsService().uploadDocument(principal.userId, requireTenantId(), id, {
      originalName,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(document, { status: 201 });
  });
}
