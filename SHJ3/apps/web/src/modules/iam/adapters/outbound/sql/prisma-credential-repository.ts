/**
 * The real `CredentialRepository` — `platform.StaffCredentials`, ADR-0006 rule 3's
 * "throwaway half" (deleted whole when SSO lands, taking this file and the port with it).
 *
 * Not exercised by B-2's own route or use cases — inviting a user creates a `StaffUser`
 * row with no credential row at all (the normal state for an unaccepted invitation, per
 * this port's own doc comment), and B-2 builds no sign-in page. It exists because
 * `LocalPasswordProvider` (ADR-0006's real local identity adapter) needs a real instance
 * of every one of its dependencies to be constructed for production use — including this
 * one, which `ResolveSession`'s per-request `resolvePrincipal()` path never calls, but
 * `authenticate()`/`completeChallenge()` (exercised directly by this wave's own live-database
 * proof script, and by whichever future wave builds a real sign-in page) do.
 *
 * `totpSecretCipher` is envelope-encrypted (`SHJ3_ENCRYPTION_KEY`,
 * `platform/adapters/outbound/crypto/envelope-encryption.ts`) — this is the one adapter in
 * the codebase that ever calls `encryptSecret`/`decryptSecret` for it, matching the
 * model's own doc comment: "the repository adapter is the only thing that ever sees the
 * ciphertext or holds the key."
 */

import {
  decryptSecret,
  encryptSecret,
} from "../../../../platform/adapters/outbound/crypto/envelope-encryption.js";
import { getPlatformDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type { LockoutState } from "../../../domain/lockout.js";
import type {
  CredentialRepository,
  PasswordRotation,
  StaffCredential,
} from "../../../ports/credential-repository.js";

const OPERATION = "iam credential repository";

interface StaffCredentialRow {
  readonly staffUserId: string;
  readonly passwordHash: string;
  readonly passwordAlgorithm: string;
  readonly passwordUpdatedAt: Date;
  readonly mustChangePassword: boolean;
  readonly totpSecretCipher: Uint8Array | null;
  readonly totpEnrolledAt: Date | null;
  readonly failedAttemptCount: number;
  readonly lockedUntil: Date | null;
}

function toDomainCredential(row: StaffCredentialRow): StaffCredential {
  return {
    staffUserId: row.staffUserId,
    passwordHash: row.passwordHash,
    passwordAlgorithm: row.passwordAlgorithm,
    passwordUpdatedAt: row.passwordUpdatedAt,
    mustChangePassword: row.mustChangePassword,
    totpSecret: row.totpSecretCipher ? decryptSecret(Buffer.from(row.totpSecretCipher)) : null,
    totpEnrolledAt: row.totpEnrolledAt,
    lockout: { failedAttemptCount: row.failedAttemptCount, lockedUntil: row.lockedUntil },
  };
}

export class PrismaCredentialRepository implements CredentialRepository {
  async find(staffUserId: string): Promise<StaffCredential | null> {
    const db = getPlatformDb(OPERATION);
    const row = await db.staffCredential.findUnique({ where: { staffUserId } });
    return row ? toDomainCredential(row) : null;
  }

  async recordLockout(staffUserId: string, state: LockoutState): Promise<void> {
    const db = getPlatformDb(OPERATION);
    await db.staffCredential.update({
      where: { staffUserId },
      data: {
        failedAttemptCount: state.failedAttemptCount,
        lockedUntil: state.lockedUntil,
        updatedAt: new Date(),
      },
    });
  }

  async replacePassword(rotation: PasswordRotation): Promise<void> {
    const db = getPlatformDb(OPERATION);
    await db.staffCredential.update({
      where: { staffUserId: rotation.staffUserId },
      data: {
        passwordHash: rotation.passwordHash,
        passwordAlgorithm: rotation.passwordAlgorithm,
        passwordUpdatedAt: rotation.at,
        mustChangePassword: rotation.mustChangePassword,
        updatedAt: rotation.at,
      },
    });
  }

  async enrolTotp(staffUserId: string, secretBase32: string, at: Date): Promise<void> {
    const db = getPlatformDb(OPERATION);
    await db.staffCredential.update({
      where: { staffUserId },
      data: {
        // `Uint8Array.from(...)`, not the `Buffer` `encryptSecret` returns directly: newer
        // `@types/node` types `Buffer` as `Uint8Array<ArrayBufferLike>` (which admits
        // `SharedArrayBuffer`), while Prisma's generated `Bytes?` field wants
        // `Uint8Array<ArrayBuffer>` specifically — a real structural mismatch under
        // `tsc`, not a style preference. This copies into a plain, definite-`ArrayBuffer`
        // view, satisfying the generated type exactly.
        totpSecretCipher: Uint8Array.from(encryptSecret(secretBase32)),
        totpEnrolledAt: at,
        updatedAt: at,
      },
    });
  }

  async listEnrolmentStatus(staffUserIds: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    if (staffUserIds.length === 0) return new Map();
    const db = getPlatformDb(OPERATION);
    const rows = await db.staffCredential.findMany({
      where: { staffUserId: { in: [...staffUserIds] } },
      select: { staffUserId: true, totpSecretCipher: true },
    });
    return new Map(rows.map((row) => [row.staffUserId, row.totpSecretCipher !== null]));
  }

  async clearTotp(staffUserId: string, at: Date): Promise<void> {
    const db = getPlatformDb(OPERATION);
    await db.staffCredential.update({
      where: { staffUserId },
      data: { totpSecretCipher: null, totpEnrolledAt: null, updatedAt: at },
    });
  }
}
