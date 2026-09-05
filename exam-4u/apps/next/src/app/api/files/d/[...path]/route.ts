import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { getFileSigningService, getStoragePortSingleton, parseRangeHeader } from '@/server/files';
import { toErrorResponse } from '@/server/common/http/error-envelope';

/**
 * `GET /api/files/d/[...path]` (FR-FILE-1/FR-FILE-2) — the public, signed-URL-gated file-download
 * route ported from `legacy/api/src/modules/files/api/files.controller.ts`'s `download`.
 *
 * **Deliberately NOT wrapped in `withTenantContext`/`requireTenantUser`** — matching the migration
 * plan's explicit instruction ("HMAC+expiry check stays the sole authorization gate on the public
 * download route, no session/JWT check there, matching legacy") and legacy's own `@Public()` route:
 * this handler never touches a tenant `DataSource` at all, only `FileSigningService.verify()`'s pure
 * HMAC/expiry check against `FILE_SIGNING_SECRET` plus the storage adapter. `middleware.ts` still
 * resolves a tenant for this path (its matcher isn't route-specific), but this handler ignores those
 * headers entirely — exactly mirroring legacy's identical global-middleware-runs-but-is-irrelevant
 * behavior for this one route.
 *
 * Streams the real Node `Readable` from `StoragePort.getStream` to the Fetch `Response` this Route
 * Handler must return via `Readable.toWeb()` — the migration plan's explicit bridge instruction.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const routeLabel = `GET ${request.nextUrl.pathname}`;

  try {
    const { path } = await params;
    const rawPath = (Array.isArray(path) ? path : [path]).map(decodeURIComponent).join('/');
    const exp = request.nextUrl.searchParams.get('exp') ?? '';
    const sig = request.nextUrl.searchParams.get('sig') ?? '';

    const signing = getFileSigningService();
    const { storageKey } = signing.verify(rawPath, exp, sig);
    const stat = await signing.stat(storageKey);

    const range = parseRangeHeader(request.headers.get('range'), stat.size);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }

    const storage = getStoragePortSingleton();

    if (range) {
      const { stream } = await storage.getStream(storageKey, range);
      const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
      return new Response(webStream, {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': stat.contentType,
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      });
    }

    const { stream } = await storage.getStream(storageKey);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': stat.contentType,
        'Content-Length': String(stat.size),
      },
    });
  } catch (err) {
    return toErrorResponse(err, requestId, routeLabel);
  }
}
