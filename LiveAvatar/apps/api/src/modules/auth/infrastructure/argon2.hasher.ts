import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasherPort } from '../domain/ports';

/**
 * Argon2id hasher (@node-rs/argon2 defaults to Argon2id).
 */
@Injectable()
export class Argon2Hasher implements PasswordHasherPort {
  /**
   * @param plain - Password
   * @returns Encoded hash
   */
  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  /**
   * @param encoded - Stored hash
   * @param plain - Candidate
   */
  verify(encoded: string, plain: string): Promise<boolean> {
    return verify(encoded, plain);
  }
}
