import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import type { AdminActor } from './admin-actor';

function extractFactory(): (data: unknown, ctx: unknown) => AdminActor | undefined {
  class Dummy {
    method(@CurrentUser() _actor: AdminActor) {
      return _actor;
    }
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Dummy, 'method');
  const key = Object.keys(args)[0];
  return args[key].factory;
}

function fakeContext(user: AdminActor | undefined) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) };
}

describe('CurrentUser decorator', () => {
  const factory = extractFactory();
  const actor: AdminActor = { id: '1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  it('returns the actor set by AdminJwtGuard', () => {
    expect(factory(undefined, fakeContext(actor))).toBe(actor);
  });

  it('returns undefined when unauthenticated', () => {
    expect(factory(undefined, fakeContext(undefined))).toBeUndefined();
  });
});
