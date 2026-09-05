import { AppError } from '../../../common/errors/app-error';

/**
 * Hostnames/ranges a tool URL may never target (SSRF baseline). Tool calls
 * are outbound requests to tenant-operated or third-party HTTP APIs — never
 * a legitimate route to platform-internal infrastructure — so unlike
 * `providers/domain/validation.ts`'s `assertEndpointUrl` (which deliberately
 * allows `localhost`/`127.0.0.1` for self-hosted provider lab use), a tool
 * URL is rejected outright for any loopback/link-local/private-range host.
 * This is a literal-hostname check, not full DNS-rebinding protection (no
 * existing SSRF-hardening utility exists elsewhere in this codebase to reuse
 * — see docs/plans/agent-builder-v2-plan.md Phase 8 security review notes
 * for the residual risk this leaves).
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (/^127\./.test(host)) {
    return true;
  }
  if (/^10\./.test(host)) {
    return true;
  }
  if (/^192\.168\./.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }
  if (/^169\.254\./.test(host)) {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  return false;
}

/**
 * @param name - Candidate tool name
 * @returns Trimmed name
 * @throws AppError 400 TOOL_NAME_REQUIRED when empty/too long
 */
export function assertToolName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw AppError.badRequest('TOOL_NAME_REQUIRED');
  }
  return trimmed;
}

/**
 * Tool URLs are always https and never target loopback/private/link-local
 * hosts (SSRF baseline — see `isBlockedHost`).
 * @param url - Candidate URL
 * @returns The validated, unmodified URL string
 * @throws AppError 400 TOOL_URL_INVALID
 */
export function assertToolUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw AppError.badRequest('TOOL_URL_INVALID');
  }
  if (parsed.protocol !== 'https:') {
    throw AppError.badRequest('TOOL_URL_INVALID');
  }
  if (isBlockedHost(parsed.hostname)) {
    throw AppError.badRequest('TOOL_URL_INVALID');
  }
  return url;
}

/**
 * Enforces R-T4-adjacent CRUD-time rule (see plan doc "Decisions made this
 * phase"): a tool declared `requires_credential: true` must carry a
 * non-empty `credential_ref`.
 * @param requiresCredential - Whether this tool is declared to need auth
 * @param credentialRef - Resulting `credential_ref` after the write
 * @throws AppError 400 TOOL_CREDENTIAL_MISSING
 */
export function assertCredentialPresence(requiresCredential: boolean, credentialRef: string | null): void {
  if (requiresCredential && !credentialRef) {
    throw AppError.badRequest('TOOL_CREDENTIAL_MISSING');
  }
}

/**
 * Derives a stable `api_ref` from a tool name when the caller doesn't supply
 * one explicitly (lowercase, non-alphanumeric runs collapsed to `_`,
 * trimmed to 64 chars to match the column width).
 * @param name - Tool name (already validated)
 */
export function deriveApiRef(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = slug.length > 0 ? slug : 'tool';
  return base.slice(0, 64);
}
