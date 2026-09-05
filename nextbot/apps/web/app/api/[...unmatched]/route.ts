import { apiNotFoundResponse } from "@/src/lib/api-not-found-response";

/**
 * Catch-all for every `/api/**` path this app does **not** implement.
 *
 * Next's App Router resolves static and named-dynamic segments ahead of a catch-all,
 * so every real route under `app/api/v1/**` and `app/api/internal/**` still wins; this
 * file only ever runs for a path that genuinely has no handler.
 *
 * ## Why this exists (NFR-11, QA retry 3, Defect 1)
 *
 * It is the other half of `requirePlatformApi()`'s "a denial must be
 * indistinguishable from a route that was never built" requirement. Both this
 * catch-all and the guard's denial path return `apiNotFoundResponse()` — the same
 * function, the same fixed bytes, through the same Route Handler response pipeline —
 * so the two are identical by construction instead of by imitation. See
 * `src/lib/api-not-found-response.ts`'s module doc for the full rationale and for the
 * measurements that ruled out imitating Next's own not-found render.
 *
 * Every method is exported (not just `GET`) so that a probe with any verb gets the
 * same answer: without a `POST` export, `POST /api/does-not-exist` would return Next's
 * `405 Method Not Allowed` while a denied `POST /api/internal/ops/tenants` returned
 * 404 — reintroducing exactly the distinguishing signal this fix removes.
 */
function notFound(): Response {
  return apiNotFoundResponse();
}

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
