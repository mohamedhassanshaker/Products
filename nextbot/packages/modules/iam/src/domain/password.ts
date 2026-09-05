import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id password hashing (LLD library table: "Password hashing (argon2id per
 * LLD)"). `@node-rs/argon2` ships prebuilt native bindings for every LLD-supported
 * platform, so no build toolchain is required at install time.
 *
 * Parameters follow OWASP's current argon2id baseline (19 MiB memory, 2 iterations,
 * 1 degree of parallelism) — deliberately conservative for a login-path hash rather
 * than a high-memory profile that would make the Admin Console login endpoint an
 * easy resource-exhaustion target (defense-in-depth alongside rate limiting).
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a plaintext password. Never logs or returns the plaintext. */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored argon2id hash. Uses the library's
 * own constant-time comparison internally (argon2's verify is timing-safe by
 * construction), satisfying the phase's "timing-safe comparison" security-review item.
 */
export async function verifyPassword(hashValue: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(hashValue, plaintext);
  } catch {
    // Malformed/corrupt hash — treat as a verification failure, never throw into the
    // caller's control flow (a throw here would behave differently from a wrong
    // password and could leak information about hash storage state).
    return false;
  }
}
