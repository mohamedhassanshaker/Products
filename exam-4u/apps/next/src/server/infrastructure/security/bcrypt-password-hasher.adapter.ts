import bcrypt from 'bcrypt';
import type { PasswordHasherPort } from '@/server/common/ports/password-hasher.port';

/**
 * The sole {@link PasswordHasherPort} implementation — ported verbatim from
 * `legacy/api/src/infrastructure/security/bcrypt-password-hasher.adapter.ts`. Nothing outside
 * `server/infrastructure/security` may import the `bcrypt` package directly (module-boundary rule) —
 * every caller (both auth realms) depends on the port, never this concrete class, so swapping the
 * hashing algorithm later only changes this one file.
 */
export class BcryptPasswordHasherAdapter implements PasswordHasherPort {
  /** @param cost bcrypt work factor (`BCRYPT_COST` env var, default 12). */
  constructor(private readonly cost: number) {}

  async hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, this.cost);
  }

  /** Never throws — a thrown error from `bcrypt.compare` (e.g. a malformed/foreign-format hash) is
   * normalized to `false`, matching legacy's identical defensive contract. */
  async compare(plainPassword: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plainPassword, hash);
    } catch {
      return false;
    }
  }
}
