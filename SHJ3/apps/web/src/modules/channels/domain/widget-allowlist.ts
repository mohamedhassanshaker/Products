/**
 * Widget embed allowlist validation (B10 tab 2; api.md §6.9's `POST
 * /channels/web-widget/allowed-domains`, FR-CHAN-09).
 *
 * "Validated as a host or single-label wildcard (`*.sharjah.ae`); an IP, a path, a scheme
 * or a bare TLD → `422 channels.domain_invalid`."
 *
 * This is deliberately **stricter than the real database CHECK constraints**
 * (`CK_WidgetAllowedDomains_noScheme`, `CK_WidgetAllowedDomains_noWildcardTld` —
 * `prisma/sql/001_constraints.sql`), which is fine and intentional: the SQL constraints
 * are the backstop that holds regardless of what wrote the row, while this function is
 * the door that gives the admin a precise, fast, honest client-and-server-side error
 * before a write is even attempted. Checked directly against the real constraints while
 * writing this: `CK_WidgetAllowedDomains_noWildcardTld` alone would *not* reject a
 * wildcarded bare TLD (`*.ae`) — its literal `LIKE '%.*'`/`'*.%.*'` patterns only catch a
 * domain that itself *ends* with the two characters `.*`, not a wildcard prefix over a
 * single-label host. So "bare TLD" from the wireframe's own prose is enforced here, one
 * layer up, not assumed to be covered by the SQL text alone (`tasks/lessons.md`'s "grep
 * the real constraint, never infer" lesson, applied to what a constraint does NOT catch).
 *
 * This is a security control, not a preference (api.md §6.9) — audited (`addedByStaffUserId`
 * on `WidgetAllowedDomain`) and it is what an unauthenticated citizen's browser is checked
 * against server-side on session creation (FR-CHAN-09).
 */

const MAX_DOMAIN_LENGTH = 253;

/** RFC 1123-ish label: alphanumeric, internal hyphens only, 1-63 chars. */
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export type WidgetAllowedDomainValidation = { readonly ok: true } | { readonly ok: false };

/**
 * `true` only for a bare host (`sharjah.ae`, `services.shj.ae`) or a single-label
 * wildcard subdomain (`*.sharjah.ae`) — never a scheme, a path, an IP literal, a bare
 * TLD, or more than one wildcard label.
 */
export function isValidWidgetAllowedDomain(rawDomain: string): boolean {
  const domain = rawDomain.trim();
  if (domain.length === 0 || domain.length > MAX_DOMAIN_LENGTH) return false;
  // No scheme, no path, no userinfo, no whitespace, no port.
  if (/[\s@:/]/.test(domain) || domain.includes("://")) return false;
  if (domain === "*") return false;

  const isWildcard = domain.startsWith("*.");
  const hostPart = isWildcard ? domain.slice(2) : domain;

  // A second "*" anywhere (a wildcard mid-host, or a wildcard repeated) is not a
  // "single-label wildcard" — reject rather than silently accept the first one.
  if (hostPart.includes("*")) return false;
  if (IPV4_PATTERN.test(hostPart)) return false;

  const labels = hostPart.split(".");
  // A bare TLD (`ae`, or a wildcard over one, `*.ae`) has fewer than two labels here.
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL_PATTERN.test(label));
}

export function validateWidgetAllowedDomain(rawDomain: string): WidgetAllowedDomainValidation {
  return isValidWidgetAllowedDomain(rawDomain) ? { ok: true } : { ok: false };
}
