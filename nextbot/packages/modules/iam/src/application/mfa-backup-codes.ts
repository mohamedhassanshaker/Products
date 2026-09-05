import type { TenantContext } from "@nextbot/db";
import { generateBackupCodes } from "../domain/totp.js";
import { hashPassword, verifyPassword } from "../domain/password.js";
import { getBackupCodesRef, setBackupCodesRef } from "../infrastructure/user-repository.js";

/**
 * QA Defect B2 (FR-SEC-03 "MFA with backup codes" — previously generated/unit-tested
 * only, never wired end to end): a single-use backup code, stored the same way a
 * password is (argon2id hash — never the raw code), plus a consumed timestamp so a
 * code can be used exactly once.
 */
interface StoredBackupCode {
  hash: string;
  usedAt: string | null;
}

/**
 * Generates a fresh set of backup codes, hashes and persists them (replacing any
 * prior set — re-enrollment invalidates old codes, matching how re-enrolling TOTP
 * invalidates the old secret), and returns the **plaintext** codes once for the
 * caller to display to the user. The plaintext is never persisted or logged.
 */
export async function generateAndPersistBackupCodes(ctx: TenantContext, userId: string): Promise<string[]> {
  const codes = generateBackupCodes();
  const stored: StoredBackupCode[] = await Promise.all(
    codes.map(async (code) => ({ hash: await hashPassword(code), usedAt: null })),
  );
  await setBackupCodesRef(ctx, userId, JSON.stringify(stored));
  return codes;
}

/**
 * Attempts to consume `rawCode` as a backup code for `userId` — the MFA challenge
 * step's alternative to a TOTP code (FR-SEC-03). Returns `true` and marks the
 * matching code consumed (so it can never be reused) if `rawCode` matches an
 * unused, previously-issued code; `false` otherwise (no matching/unused code, or no
 * backup codes were ever generated for this user).
 */
export async function consumeBackupCode(ctx: TenantContext, userId: string, rawCode: string): Promise<boolean> {
  const ref = await getBackupCodesRef(ctx, userId);
  if (!ref) return false;

  let stored: StoredBackupCode[];
  try {
    stored = JSON.parse(ref) as StoredBackupCode[];
  } catch {
    return false;
  }

  for (const entry of stored) {
    if (entry.usedAt) continue; // already consumed — never matches again
    // Checked sequentially, not in parallel: early-exit on the first match, and
    // consumption (marking `usedAt` + persisting) must happen atomically per
    // candidate before considering the next one.
    if (await verifyPassword(entry.hash, rawCode)) {
      entry.usedAt = new Date().toISOString();
      await setBackupCodesRef(ctx, userId, JSON.stringify(stored));
      return true;
    }
  }
  return false;
}
