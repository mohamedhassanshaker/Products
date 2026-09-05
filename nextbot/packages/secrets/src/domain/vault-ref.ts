/**
 * `vault_ref` is the opaque pointer format stored in first-party columns
 * (`credential.vault_ref`, `app_user.mfa_secret_ref`), never the ciphertext itself:
 * `nb://<tenant>/<kind>/<uuid>` (LLD §3.5).
 */
export function buildVaultRef(tenantId: string, kind: string, id: string): string {
  return `nb://${tenantId}/${kind}/${id}`;
}

export interface ParsedVaultRef {
  tenantId: string;
  kind: string;
  id: string;
}

const VAULT_REF_RE = /^nb:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;

/** @throws {Error} if `ref` is not a well-formed `nb://` vault reference. */
export function parseVaultRef(ref: string): ParsedVaultRef {
  const match = VAULT_REF_RE.exec(ref);
  if (!match) throw new Error(`Malformed vault_ref: ${JSON.stringify(ref)}`);
  const [, tenantId, kind, id] = match;
  return { tenantId: tenantId!, kind: kind!, id: id! };
}
