import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getEnv } from '@/server/config';
import { getProfileService, FileTooLargeError } from '@/server/profile';
import { ValidationFailedError } from '@/server/common/errors/domain-error';

/** Generous fixed allowance (bytes) for multipart boundary/header overhead on top of the actual file
 * payload — a `multipart/form-data` body is always somewhat larger than the file it carries (field
 * name, boundary delimiters, `Content-Disposition`/`Content-Type` sub-headers). Large enough that no
 * legitimate single-file upload is ever falsely rejected by the `Content-Length` pre-check below,
 * small enough to still meaningfully bound how large a body this route will ever attempt to parse. */
const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 65_536;

/**
 * `POST /api/profile/picture` — self-service avatar upload (FR-IAM-4). Uses the Fetch `FormData` API
 * (`request.formData()`), this app's equivalent of legacy's `multer`-backed `FileInterceptor`.
 *
 * **Real defect found and fixed only by actually sending large real HTTP uploads (never surfaced by
 * a vitest-only test, which never drives real Node HTTP body parsing)**: calling
 * `request.formData()` on a body meaningfully larger than `MAX_AVATAR_SIZE_BYTES` (observed from
 * roughly 6MB) intermittently throws `TypeError: Failed to parse body as FormData` from inside
 * Node's own `undici` internals — a **500**, not the clean `413 FILE_TOO_LARGE`
 * `ProfileService.uploadPicture`'s own post-parse size re-check was meant to produce (that check
 * never even runs, since the throw happens *during* `formData()` itself, before this handler's code
 * resumes). This reproduced nondeterministically (roughly 4 of 5 attempts at the same oversized file)
 * against a real `next start` production boot — a genuine intermittent bug in the underlying body
 * parser at that size, not a mistake in this app's own size-check logic.
 *
 * **Fix**: a `Content-Length`-based pre-check *before* ever calling `request.formData()` — mirrors
 * legacy's own `multer`-level "the size cap applied before buffering" requirement (LLD §12.2) more
 * faithfully than the post-parse-only check this route shipped with initially, and sidesteps the
 * flaky undici code path entirely for any client that reports its body size up front (every browser
 * `fetch`/`FormData` upload and every `curl -F` invocation does). A client omitting `Content-Length`
 * (e.g. genuine chunked transfer-encoding) still falls through to `ProfileService.uploadPicture`'s
 * own authoritative re-check — documented as a residual, narrower gap rather than silently unfixed.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);

    const maxBytes = getEnv().MAX_AVATAR_SIZE_BYTES;
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes + MULTIPART_OVERHEAD_ALLOWANCE_BYTES) {
      throw new FileTooLargeError(maxBytes);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      throw new ValidationFailedError([{ field: 'file', constraint: 'A "file" multipart field is required.' }]);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const updated = await getProfileService().uploadPicture(principal.userId, { buffer, size: buffer.length });
    return NextResponse.json(updated);
  });
}
