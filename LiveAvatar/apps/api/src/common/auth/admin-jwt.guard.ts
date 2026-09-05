import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppError } from '../errors/app-error';

/**
 * Requires a valid admin access JWT (`typ=admin`). Conversation / LiveKit
 * tokens (FR-AUTH-5) are rejected as AUTH_UNAUTHORIZED.
 */
@Injectable()
export class AdminJwtGuard extends AuthGuard('admin-jwt') {
  /**
   * Maps Passport failures to the spec 401 envelope.
   * @param err - Strategy error
   * @param user - Validated actor
   */
  handleRequest<T>(err: unknown, user: T): T {
    if (err || !user) {
      throw err instanceof AppError ? err : AppError.unauthorized();
    }
    return user;
  }

  /**
   * @param context - HTTP context
   */
  override canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
