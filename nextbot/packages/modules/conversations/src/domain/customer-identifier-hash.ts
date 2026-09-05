import { createHash } from "node:crypto";

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — computes
 * `conversation.customer_identifier_hash` from a raw customer identifier (a phone
 * number, email, or other channel-supplied identifier). Pure/I/O-free (domain layer
 * rule, LLD §2.2) — `node:crypto`'s `createHash` performs no I/O, matching the
 * project's existing precedent for other domain-layer HMAC/hash helpers
 * (`hashDefinitionArtifact`, `hashSkillArtifact`, `computeHmacSha256Hex`).
 *
 * Normalizes (trim + lowercase) before hashing so that two representations of the
 * SAME identifier that differ only in incidental formatting (e.g. trailing
 * whitespace, mixed-case email) still hash identically — this is normalization, not
 * fuzzy matching: two DIFFERENT identifiers (a different phone number, a different
 * email address, a single differing digit) always normalize to different strings and
 * therefore hash differently. FR-OC-08's exact-match-only requirement depends on this
 * distinction; see this module's adversarial test proving it holds.
 */
export function computeCustomerIdentifierHash(rawIdentifier: string): string {
  const normalized = rawIdentifier.trim().toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
