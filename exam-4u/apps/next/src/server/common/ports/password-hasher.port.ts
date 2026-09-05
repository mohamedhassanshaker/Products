/**
 * Port for one-way password hashing/verification — ported verbatim from
 * `legacy/api/src/modules/auth/domain/ports/password-hasher.port.ts`. Shared by both auth realms
 * (tenant-user password login/registration/reset, platform-admin login) — kept in `server/common/`
 * (no module-boundary ESLint rule, matching `DomainError`'s own precedent) rather than duplicated
 * once per realm, since it is a pure contract with zero implementation/state of its own to protect.
 *
 * The sole implementation, {@link import('../../infrastructure/security').BcryptPasswordHasherAdapter},
 * lives under `server/infrastructure/security` (a real module boundary — it owns the actual `bcrypt`
 * dependency, which nothing outside that module may import directly).
 */
export interface PasswordHasherPort {
  /** Hashes `plainPassword`. Never throws for a well-formed string input. */
  hash(plainPassword: string): Promise<string>;
  /**
   * Compares `plainPassword` against `hash`. Must never throw — any internal failure (e.g. a
   * malformed/foreign-format hash) is normalized to `false`, matching bcrypt's own documented
   * failure-mode contract (ported verbatim from the legacy adapter).
   */
  compare(plainPassword: string, hash: string): Promise<boolean>;
}
