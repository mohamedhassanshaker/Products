/**
 * Validates the `env:`/`k8s:`/`vault:` secret-reference convention (architecture §10) —
 * a *reference* to where a real secret lives, never the secret's value itself. Mirrors
 * `CK_WhatsAppConfigs_secretIsReference` (`prisma/sql/001_constraints.sql`) exactly, so a
 * bad reference is refused here, with a real, translated reason, before it ever reaches the
 * database's own CHECK constraint — matching this codebase's own preference for a domain-
 * layer refusal over a raw constraint-violation message bubbling up to a Server Action's
 * catch block.
 *
 * No vendor imports (architecture.md §4): pure string check, testable without a database.
 */
const SECRET_REFERENCE_PREFIXES = ["env:", "k8s:", "vault:"] as const;

export function isValidSecretReference(value: string): boolean {
  return SECRET_REFERENCE_PREFIXES.some(
    (prefix) => value.startsWith(prefix) && value.length > prefix.length,
  );
}
