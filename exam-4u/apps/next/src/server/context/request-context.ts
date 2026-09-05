import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSource } from 'typeorm';

/**
 * Per-request context store — ported from `legacy/api/src/common/context/request-context.ts`'s
 * `RequestContext`, adapted to this app's realm split. Populated once per Route Handler invocation by
 * {@link import('./with-tenant-context').withTenantContext} or
 * {@link import('./with-platform-auth').withPlatformAuth} — never across the `middleware.ts` →
 * Route-Handler boundary (migration plan: "it does not try to carry `AsyncLocalStorage` across the
 * middleware→handler boundary — Next.js doesn't guarantee that continuation the way Nest's Express
 * chain does"). `middleware.ts` instead passes `x-tenant-id`/`x-tenant-slug`/`x-tenant-schema` as
 * trusted headers, which `withTenantContext` reads to (re)establish this store fresh inside the
 * handler's own async call graph.
 *
 * `platformAdminId` is new relative to legacy's single shared `RequestContext` shape — legacy never
 * needed it because `PlatformAdminGuard` attaches `request.platformAdmin` directly to the Express
 * request object instead of the ALS store. This app has no per-request "request object" a guard-
 * equivalent helper can mutate outside of ALS (a Route Handler only receives the Fetch `Request`,
 * which callers must treat as immutable), so the ALS store carries every realm's principal Id
 * uniformly.
 */
export interface RequestContext {
  requestId: string;
  tenantId?: string;
  tenantSchema?: string;
  tenantSlug?: string;
  /** Set once a tenant-realm bearer token has been verified (`auth`'s `requireTenantUser` helper). */
  userId?: string;
  /** Set once a platform-realm bearer token has been verified (`withPlatformAuth`). */
  platformAdminId?: string;
  /** The ALS-resolved tenant's pooled `DataSource`, acquired by `withTenantContext` for the duration
   * of the handler call — read via `context/tenant-context.ts`'s `requireTenantDataSource()`, never
   * directly, so a raw `DataSource` never leaks into business logic (LLD §1.3-equivalent). */
  tenantDataSource?: DataSource;
  /** Per-request memoized effective-permission-name set for the authenticated tenant user
   * (`rbac`'s `PermissionResolutionService`) — populated on first resolution within a request so a
   * handler that checks multiple permissions (or also reads permissions for display, e.g.
   * `GET /auth/me`) never re-runs the `user_role`/`role_permission`/`permission` join more than once
   * per request. */
  effectivePermissions?: Set<string>;
}

/** The process-wide `AsyncLocalStorage` instance. Only `withTenantContext`/`withPlatformAuth` call
 * {@link runWithRequestContext}; everything else reads via {@link getRequestContext}. */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` bound for the duration of the async call graph beneath it. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

/** Returns the current request's context, or `undefined` if called outside any request (e.g. a
 * script or a code path reached without going through `withTenantContext`/`withPlatformAuth`). */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
