import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { AdminActor } from './admin-actor';
import { AppError } from '../errors/app-error';

/**
 * Any-of role check. Missing `@Roles` means any authenticated admin is enough.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * @param context - HTTP context
   * @returns true when the actor holds at least one required role
   * @throws AppError AUTH_ROLE_FORBIDDEN when the actor lacks the role
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<{ user?: AdminActor }>();
    const actor = req.user;
    if (!actor) {
      throw AppError.unauthorized();
    }
    if (!required.some((role) => actor.roles.includes(role))) {
      throw AppError.forbidden('AUTH_ROLE_FORBIDDEN');
    }
    return true;
  }
}
