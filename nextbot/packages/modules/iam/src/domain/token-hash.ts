import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Phase 4 (BL-36, FR-SEC-10): argon2id hashing for bearer secrets that are NOT
 * passwords — SCIM bearer tokens and service-account API keys. Same algorithm/
 * parameters `domain/password.ts` uses for login passwords (this project's
 * established "how are credentials stored" pattern — see the security brief's
 * "match the existing session/credential storage pattern" requirement), kept as
 * a distinct, clearly-named export so a reader doesn't have to reason about why
 * an API key is being run through a function literally named `hashPassword`.
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a bearer secret (API key / SCIM token). Never logs or returns the plaintext. */
export async function hashBearerSecret(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/** Verifies a plaintext bearer secret against its stored argon2id hash. Never
 * throws on a malformed/corrupt hash — treated as a verification failure, same
 * defensive stance as `password.ts`'s `verifyPassword`. */
export async function verifyBearerSecret(hashValue: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(hashValue, plaintext);
  } catch {
    return false;
  }
}

/** Generates a cryptographically random, URL-safe secret of `bytes` entropy bytes
 * (default 24 -> 32 base64url characters, ~192 bits). Used for both the SCIM
 * bearer token and the secret segment of an API key. */
export function generateRandomSecret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
