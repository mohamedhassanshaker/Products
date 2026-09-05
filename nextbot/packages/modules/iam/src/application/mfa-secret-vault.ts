import { KmsEnvelopeSecretsProvider, parseVaultRef } from "@nextbot/secrets";
import type { TenantContext } from "@nextbot/db";
import { generateTotpEnrollment } from "../domain/totp.js";
import { insertMfaSecret, findMfaSecretById } from "../infrastructure/mfa-secret-repository.js";
import { enrollMfa } from "../infrastructure/user-repository.js";
import { generateAndPersistBackupCodes } from "./mfa-backup-codes.js";

const MFA_SECRET_KIND = "mfa-secret";

let provider: KmsEnvelopeSecretsProvider | undefined;
function getProvider(): KmsEnvelopeSecretsProvider {
  if (!provider) provider = new KmsEnvelopeSecretsProvider();
  return provider;
}

/**
 * Enrolls a user in TOTP MFA: generates a secret, envelope-encrypts it (ADR-0007),
 * persists only the ciphertext (`mfa_secret` table) and sets `app_user.mfa_secret_ref`
 * to the resulting `vault_ref` pointer. Also generates a fresh set of single-use
 * backup codes (QA Defect B2 — previously generated/tested but never wired into
 * enrollment) and returns both: the `otpauthUri` for the caller to render as a QR
 * code, and the **plaintext** backup codes to display exactly once — neither the
 * TOTP secret nor the backup codes are ever retrievable again after this call
 * returns (only their hash/ciphertext is persisted).
 */
export async function enrollTotpMfa(
  ctx: TenantContext,
  userId: string,
  accountLabel: string,
): Promise<{ otpauthUri: string; backupCodes: string[] }> {
  const enrollment = generateTotpEnrollment(accountLabel);
  // Same id is used both as the `mfa_secret` row's PK and as the envelope
  // encryption's AAD context id — see the analogous note in create-connector.ts.
  const rowId = crypto.randomUUID();
  const encrypted = await getProvider().put(enrollment.secretBase32, { tenantId: ctx.tenantId, kind: MFA_SECRET_KIND, id: rowId });
  const secretRowId = await insertMfaSecret(ctx, { id: rowId, userId, ciphertext: encrypted.ciphertext, dekRef: encrypted.dekRef });
  await enrollMfa(ctx, userId, `nb://${ctx.tenantId}/${MFA_SECRET_KIND}/${secretRowId}`);
  const backupCodes = await generateAndPersistBackupCodes(ctx, userId);
  return { otpauthUri: enrollment.otpauthUri, backupCodes };
}

/** Decrypts the TOTP secret referenced by `app_user.mfa_secret_ref`, for verifying a
 * login-time challenge code. Never returns the secret to an HTTP response body. */
export async function decryptMfaSecret(ctx: TenantContext, mfaSecretRef: string): Promise<string> {
  const parsed = parseVaultRef(mfaSecretRef);
  const row = await findMfaSecretById(ctx, parsed.id);
  if (!row) throw new Error(`mfa_secret row not found for vault_ref ${mfaSecretRef}`);
  return getProvider().get(row.ciphertext, row.dekRef, { tenantId: ctx.tenantId, kind: MFA_SECRET_KIND, id: parsed.id });
}
