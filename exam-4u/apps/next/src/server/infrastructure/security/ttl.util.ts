/**
 * Parses a legacy-style TTL string (`(\d+)(s|m|h|d)?`) into whole seconds — ported verbatim from
 * `legacy/api/src/infrastructure/security/jwt-tenant-token.adapter.ts`'s `parseTtlToSeconds` (shared,
 * byte-identical logic, with `jwt-platform-token.adapter.ts`'s own copy). A bare integer with no unit
 * suffix is treated as whole seconds; anything that doesn't match the pattern at all falls back to
 * `3600` (1 hour) rather than throwing — a malformed TTL env var should degrade to a safe default,
 * not crash token issuance.
 *
 * @param ttl e.g. `'60m'`, `'3600'`, `'24h'`, `'7d'`.
 */
export function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(ttl.trim());
  if (!match) return 3600;
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return value * multiplier[unit];
}
