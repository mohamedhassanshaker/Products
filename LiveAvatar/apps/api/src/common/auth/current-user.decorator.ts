import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminActor } from './admin-actor';

/**
 * Returns the AdminActor set by AdminJwtGuard.
 * @returns Actor or undefined when unauthenticated
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminActor | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AdminActor }>();
    return req.user;
  },
);
