import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AdminIdentity } from '../domain/admin-identity';
import type { TokenSignerPort } from '../domain/ports';

/**
 * Signs 8h admin access tokens with claims sub, email, roles, tenant_ids, typ.
 */
@Injectable()
export class JwtSigner implements TokenSignerPort {
  constructor(private readonly jwt: JwtService) {}

  /**
   * @param identity - Admin to encode
   * @returns Compact JWT
   */
  signAccess(identity: AdminIdentity): string {
    return this.jwt.sign(
      {
        sub: identity.id,
        email: identity.email,
        roles: identity.roles,
        tenant_ids: identity.tenantIds,
        typ: 'admin',
      },
      { expiresIn: '8h', secret: process.env.JWT_ACCESS_SECRET },
    );
  }
}
