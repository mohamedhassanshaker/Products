import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { toErrorResponse } from '@/server/common/http/error-envelope';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import { getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { runWithRequestContext } from './request-context';

/** `X-Request-Id` (or `x-request-id`, headers are case-insensitive) — echoed into every error
 * envelope's `requestId` field, generated fresh if the caller/proxy didn't set one. */
function resolveRequestId(request: NextRequest): string {
  return request.headers.get('x-request-id') ?? randomUUID();
}

/**
 * The shared wrapper every tenant-scoped Route Handler/Server Action calls (migration plan: "Every
 * Route Handler/Server Action wraps its body in a shared `withTenantContext(request, handler)` that
 * reads those headers, acquires the pooled `DataSource`... and runs the handler inside
 * `als.run(ctx, handler)`"). Reads the trusted `x-tenant-id`/`x-tenant-slug`/`x-tenant-schema`
 * headers `middleware.ts` already set (after a successful tenant resolution — see
 * `server/tenancy`'s `resolveTenantForRequest`), acquires that tenant's pooled `DataSource` from the
 * `TenantDataSourceRegistry`, binds an ALS {@link import('./request-context').RequestContext} for the
 * duration of `handler()`, and releases the pooled `DataSource` in a `finally` regardless of how
 * `handler` completes.
 *
 * Also the chokepoint that converts any thrown `DomainError` (from `handler`, or from a repository/
 * service it calls) into the standard `ErrorEnvelope` `NextResponse` — the Next.js equivalent of
 * legacy's global `AllExceptionsFilter`, since Next.js has no per-request exception-filter mechanism
 * of its own. Individual Route Handlers therefore never need their own try/catch: they just `throw`
 * a `DomainError` subclass and let this wrapper translate it.
 *
 * @param request The incoming Fetch `Request` (Next's `NextRequest`) — read-only; never mutated.
 * @param handler The Route Handler's actual body. Runs entirely inside the ALS binding, so any code
 *   it calls (transitively) can read `getRequestContext()`/`requireTenantDataSource()`.
 * @returns Whatever `handler` returns, or a `NextResponse` error envelope if the trusted headers are
 *   missing (should be unreachable in production — `middleware.ts`'s matcher already scopes which
 *   routes get tenant-resolved) or `handler` throws.
 */
export async function withTenantContext(request: NextRequest, handler: () => Promise<Response>): Promise<Response> {
  const requestId = resolveRequestId(request);
  const tenantId = request.headers.get('x-tenant-id');
  const tenantSlug = request.headers.get('x-tenant-slug');
  const tenantSchema = request.headers.get('x-tenant-schema');

  if (!tenantId || !tenantSlug || !tenantSchema) {
    // Defensive — should be unreachable: every route this wrapper guards is also matched by
    // `middleware.ts`'s matcher, which never calls `next()` without setting all three headers.
    return toErrorResponse(
      new InternalDomainError(new Error('withTenantContext() called with no resolved tenant headers present.')),
      requestId,
      `${request.method} ${request.nextUrl.pathname}`,
    );
  }

  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(tenantSchema);
  try {
    return await runWithRequestContext({ requestId, tenantId, tenantSlug, tenantSchema, tenantDataSource: dataSource }, handler);
  } catch (err) {
    return toErrorResponse(err, requestId, `${request.method} ${request.nextUrl.pathname}`);
  } finally {
    registry.release(tenantSchema);
  }
}
