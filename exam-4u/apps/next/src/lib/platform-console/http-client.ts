import { PlatformApiError } from './api-error';
import { getStoredPlatformToken } from './token-storage';

/**
 * The `platform-console`'s single fetch chokepoint — every typed API module (`auth-api.ts`,
 * `tenants-api.ts`) calls through this rather than hand-rolling `fetch` + header/error handling per
 * call site. This is this app's client-side equivalent of the legacy Angular app's `HttpClient` +
 * `AuthInterceptor` pairing (attach the bearer token, normalize error shape) — collapsed into one
 * function since there's no interceptor/DI mechanism in a plain React client bundle.
 *
 * Always sends `Authorization: Bearer <token>` when a token is stored (every route this module calls
 * is `withPlatformAuth`-gated except login itself, which never has a token yet). Parses a non-2xx
 * response as an `ErrorEnvelope` and throws {@link PlatformApiError}; a malformed/non-JSON error body
 * (a raw 502 from an intermediary proxy, say) falls back to a generic message rather than throwing a
 * second, confusing parse error on top of the original HTTP failure.
 */
export async function platformFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredPlatformToken();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    // A network-level failure (offline, DNS, CORS) never reaches the server at all — there is no
    // ErrorEnvelope to parse, so this is the one case with a hardcoded, generic client-side message.
    throw new PlatformApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const rawText = await response.text();
  const parsed: unknown = rawText ? safeJsonParse(rawText) : undefined;

  if (!response.ok) {
    const envelopeError = isErrorEnvelope(parsed) ? parsed.error : undefined;
    throw new PlatformApiError(
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
