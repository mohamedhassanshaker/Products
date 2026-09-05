import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppError } from '../errors/app-error';
import type { AdminActor } from './admin-actor';

/** Access-token claims issued by JwtSigner (FR-AUTH-1, FR-AUTH-5). */
export interface AdminJwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tenant_ids: string[];
  typ: string;
  exp: number;
}

/**
 * Passport JWT strategy. Rejects tokens that are not `typ=admin` so a later
 * conversation/LiveKit token cannot call admin APIs (FR-AUTH-5).
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-not-for-prod',
      ignoreExpiration: false,
    });
  }

  /**
   * @param payload - Decoded JWT
   * @returns AdminActor stored on `req.user`
   * @throws AppError AUTH_UNAUTHORIZED when typ is not admin
   */
  validate(payload: AdminJwtPayload): AdminActor {
    if (payload.typ !== 'admin' || !payload.sub || !Array.isArray(payload.roles)) {
      throw AppError.unauthorized();
    }
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
      tenantIds: payload.tenant_ids ?? [],
    };
  }
}
