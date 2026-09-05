import { containsSecretKey } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { ProviderHosting } from './provider';

/**
 * `remote` providers (third-party SaaS vendors — OpenAI, ElevenLabs, etc.)
 * must be https, except `http://localhost` / `http://127.0.0.1` for lab use
 * (FR-PROVIDER-2). `self_hosted` providers are, by definition, operator-run
 * infrastructure the control plane has no business restricting the scheme
 * of — plain `http://<any-host>` (e.g. the compose-internal `livekit`
 * service) is legitimate, as is `file://` for adapters that address a local
 * model directory rather than a network call (e.g. bitHuman — see
 * `apps/agent/src/avatar_agent/adapters/avatar/bithuman.py`'s
 * `_resolve_model_path`, which documents `file://` as an accepted
 * `endpoint_url` form). Throws the spec's exact code on any other
 * scheme/host.
 * @param endpointUrl - Candidate endpoint
 * @param hosting - The provider definition's `hosting` (determines how
 *   permissive the scheme/host check is)
 * @returns The validated, unmodified URL string
 */
export function assertEndpointUrl(endpointUrl: string, hosting: ProviderHosting): string {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw AppError.badRequest('PROVIDER_ENDPOINT_INVALID');
  }
  if (hosting === 'self_hosted') {
    const isValid = parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
    if (!isValid) {
      throw AppError.badRequest('PROVIDER_ENDPOINT_INVALID');
    }
    return endpointUrl;
  }
  const isHttps = parsed.protocol === 'https:';
  const isLoopbackHttp =
    parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (!isHttps && !isLoopbackHttp) {
    throw AppError.badRequest('PROVIDER_ENDPOINT_INVALID');
  }
  return endpointUrl;
}

/**
 * Rejects an `extra` blob containing a raw-secret-shaped key anywhere in its
 * structure (FR-PROVIDER-2). Shared scan logic lives in
 * `@liveavatar/contracts` so the YAML-side guard (FR-PROVIDER-7) can never
 * drift from this one.
 * @param extra - Caller-supplied non-secret knobs
 */
export function assertNoSecretInExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = extra ?? {};
  if (containsSecretKey(value)) {
    throw AppError.badRequest('PROVIDER_SECRET_IN_BODY');
  }
  const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size > 8192) {
    throw AppError.badRequest('PROVIDER_SECRET_IN_BODY', { fields: { extra: 'must be at most 8 KB' } });
  }
  return value;
}
