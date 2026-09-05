import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { RolesGuard } from './roles.guard';
import type { AdminActor } from './admin-actor';

function makeContext(user: AdminActor | undefined) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('RolesGuard', () => {
  const actor: AdminActor = { id: '1', email: 'a@b.com', roles: ['admin'], tenantIds: [] };

  it('allows the request when no @Roles metadata is set', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(actor))).toBe(true);
  });

  it('allows the request when required roles is an empty array', () => {
    const reflector = { getAllAndOverride: () => [] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(actor))).toBe(true);
  });

  it('allows an actor holding one of the required roles', () => {
    const reflector = { getAllAndOverride: () => ['admin', 'operator'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(actor))).toBe(true);
  });

  it('rejects an unauthenticated request with AUTH_UNAUTHORIZED', () => {
    const reflector = { getAllAndOverride: () => ['operator'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(AppError);
  });

  it('rejects an actor lacking the required role with AUTH_ROLE_FORBIDDEN', () => {
    const reflector = { getAllAndOverride: () => ['operator'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    try {
      guard.canActivate(makeContext(actor));
      fail('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe('AUTH_ROLE_FORBIDDEN');
      expect((err as AppError).httpStatus).toBe(403);
    }
  });
});
