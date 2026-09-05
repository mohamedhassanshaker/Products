import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TokenDigestPort } from '../domain/ports';

/**
 * SHA-256 hex digest + CSPRNG tokens for refresh/invite.
 */
@Injectable()
export class Sha256TokenDigest implements TokenDigestPort {
  /**
   * @param token - Opaque secret
   * @returns Hex SHA-256
   */
  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** @returns 48-byte url-safe token */
  randomToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /** @returns UUID family id */
  randomFamilyId(): string {
    return randomUUID();
  }
}
