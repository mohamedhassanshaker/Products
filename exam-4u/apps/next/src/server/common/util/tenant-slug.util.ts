import { randomUUID } from 'node:crypto';

/**
 * FR-MT-1: "restricted to lowercase alphanumeric + hyphen, max 63 characters" — ported verbatim from
 * `legacy/api/src/common/util/tenant-slug.util.ts`. Also rejects a leading/trailing/consecutive
 * hyphen — a stricter, DNS-label-safe reading required for `{slug}.examland.app` to ever be a
 * well-formed, unambiguous hostname.
 */
const SUBDOMAIN_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SUBDOMAIN_LENGTH = 63;
const MAX_SCHEMA_SLUG_LENGTH = 20;

/** Validates a subdomain slug against FR-MT-1's character-set/length rule (reserved-slug rejection is
 * a separate, config-driven check — see `getEnv().RESERVED_SUBDOMAINS` — since it's deployment
 * config, not an intrinsic property of the string). */
export function isValidSubdomainSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SUBDOMAIN_LENGTH && SUBDOMAIN_SLUG_PATTERN.test(slug);
}

/**
 * HLD §4.1 tenant schema naming convention: `t_{sanitizedSlug(≤20)}_{first8(uuidNoDashes)}` (example:
 * slug `acme-medical` → schema `t_acme_medical_9f3b21ac`) — ported verbatim from
 * `legacy/api/src/common/util/tenant-slug.util.ts`. Hyphens are folded to underscores in the
 * schema-name segment only (the subdomain slug itself keeps its hyphens) purely for a friendlier/more
 * conventional MySQL identifier.
 *
 * The trailing random UUID segment is what actually guarantees uniqueness/validity — a
 * delete-then-recreate of a tenant on the same slug can never collide with the original
 * (now purged-or-purging) schema name, and it pads out short slugs so the identifier is never empty
 * or pathologically short.
 */
export function generateTenantSchemaName(slug: string): string {
  const sanitized = slug
    .replace(/-/g, '_')
    .slice(0, MAX_SCHEMA_SLUG_LENGTH)
    .replace(/_+$/, '');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  return `t_${sanitized}_${suffix}`;
}
