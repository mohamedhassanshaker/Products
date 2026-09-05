import { TenantApiError } from './api-error';
import { getStoredTenantToken } from './token-storage';

/**
 * The `tenant-console`'s single fetch chokepoint — every typed API module (`auth-api.ts`,
 * `taxonomy-api.ts`, `curricula-api.ts`) calls through this rather than hand-rolling `fetch` +
 * header/error handling per call site. Mirrors `lib/platform-console/http-client.ts`'s identical shape
 * (attach the bearer token, normalize error shape) — kept as its own copy rather than shared, matching
 * `api-error.ts`'s own "deliberately independent realm bundles" rationale.
 */
export async function tenantFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredTenantToken();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  // A `FormData` body (added Phase 4, `POST /api/exam-types/zip`'s multipart ZIP upload — this app's
  // first client-side multipart request) must NEVER get an explicit `content-type` header here — the
  // browser sets `multipart/form-data; boundary=...` itself from the `FormData` object, and overriding
  // it with `application/json` would silently corrupt every multipart upload sent through this
  // function.
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new TenantApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const rawText = await response.text();
  const parsed: unknown = rawText ? safeJsonParse(rawText) : undefined;

  if (!response.ok) {
    const envelopeError = isErrorEnvelope(parsed) ? parsed.error : undefined;
    throw new TenantApiError(
      response.status,
      envelopeError?.code ?? 'UNKNOWN_ERROR',
      envelopeError?.message ?? 'An unexpected error occurred. Please try again.',
      envelopeError?.details,
    );
  }

  return parsed as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isErrorEnvelope(value: unknown): value is { error: { code: string; message: string; details?: Record<string, unknown> } } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error: unknown }).error === 'object';
}
