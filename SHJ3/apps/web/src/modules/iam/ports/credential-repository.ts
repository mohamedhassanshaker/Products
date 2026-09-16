/**
 * Local credential persistence — the throwaway half, isolated on purpose.
 *
 * ADR-0006 rule 3: the user record has **no** `password_hash` column. Secrets
 * live in `platform.StaffCredentials`, a table owned solely by the local password
 * adapter, so when SSO lands the migration is `DROP TABLE StaffCredentials` and
 * nothing else changes. A deletion, not a restructuring.
 *
 * This port is the code-level expression of that boundary, and the reason it is a
 * separate file from `user-repository.ts` rather than more methods on it:
 *
 *  - **Exactly one implementation and exactly one consumer.** Written by
 *    `LocalPasswordProvider`, read by `LocalPasswordProvider`. When `OidcProvider`
 *    arrives, this file and its adapter are deleted together and no import
 *    anywhere else breaks — which is the test of whether the boundary was real.
 *  - **The table carries its own narrower grant.** Argon2id hashes, TOTP secrets
 *    and lockout counters are readable by the auth adapter's database role and by
 *    nothing else, so an entity-admin-facing user listing physically cannot
 *    project them.
 *
 * No application module and no feature module may import this file. If one ever
 * needs to, the design is wrong (ADR-0006 rule 1).
 */

import type { LockoutState } from "../domain/lockout.js";

/**
 * The credential row, decrypted.
 *
 * `totpSecret` arrives as base32 because that is what an authenticator app
 * consumes; the column is `totpSecretCipher`, envelope-encrypted, and the
 * repository adapter is the only thing that ever sees the ciphertext or holds the
 * key (architecture.md §10).
 */
export interface StaffCredential {
  readonly staffUserId: string;
  /** PHC-encoded Argon2id string. The parameters travel inside it, which is what makes rehashing on a policy change possible. */
  readonly passwordHash: string;
  /** `CK_StaffCredentials_algorithm` constrains this to `argon2id` in the database. */
  readonly passwordAlgorithm: string;
  readonly passwordUpdatedAt: Date;
  /**
   * Forced rotation. Set on invite acceptance and on an admin-performed reset
   * (ADR-0006 rule 4), and it must gate the *session*, not just the UI: a user
   * who ignores the change-password screen still holds a session, so the flag
   * travels with the principal resolution rather than the login response.
   */
  readonly mustChangePassword: boolean;
  readonly totpSecret: string | null;
  readonly totpEnrolledAt: Date | null;
  readonly lockout: LockoutState;
}

export interface PasswordRotation {
  readonly staffUserId: string;
  readonly passwordHash: string;
  readonly passwordAlgorithm: string;
  readonly at: Date;
  readonly mustChangePassword: boolean;
}

export interface CredentialRepository {
  /**
   * Null for a user with no credential row — which is the normal state under
   * SSO, and the state of an `Invited` user who has not accepted yet. The caller
   * must treat null exactly like a wrong password (see `LocalPasswordProvider`),
   * or the absence becomes an account-enumeration oracle.
   */
  find(staffUserId: string): Promise<StaffCredential | null>;

  /** Persist the attempt counters. Called on every failure and every success. */
  recordLockout(staffUserId: string, state: LockoutState): Promise<void>;

  /**
   * Replace the password hash.
   *
   * Rotation is a privilege change, so the caller must also revoke the user's
   * other sessions (api.md §3.6). That is not this port's job, but it is this
   * port's only caller's job, and the two must not drift apart.
   */
  replacePassword(rotation: PasswordRotation): Promise<void>;

  /** Store an envelope-encrypted TOTP secret and stamp `totpEnrolledAt`. */
  enrolTotp(staffUserId: string, secretBase32: string, at: Date): Promise<void>;

  /**
   * `staffUserId -> has a non-null totpSecret`. Batched (not one `find()` per row)
   * because the Security tab's TOTP list renders one row per staff user.
   * A staff user with no credential row at all (SSO, or an unaccepted invitation)
   * is absent from the map — the caller treats absence the same as `false`.
   */
  listEnrolmentStatus(staffUserIds: readonly string[]): Promise<ReadonlyMap<string, boolean>>;

  /** Clear the stored TOTP secret and `totpEnrolledAt` — an admin-forced re-enrolment. */
  clearTotp(staffUserId: string, at: Date): Promise<void>;
}
