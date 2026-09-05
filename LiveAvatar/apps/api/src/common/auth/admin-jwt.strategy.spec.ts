import { AppError } from '../errors/app-error';
import { AdminJwtStrategy, type AdminJwtPayload } from './admin-jwt.strategy';

const basePayload: AdminJwtPayload = {
  sub: 'admin-1',
  email: 'a@b.com',
  roles: ['operator'],
  tenant_ids: [],
  typ: 'admin',
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('AdminJwtStrategy', () => {
  const strategy = new AdminJwtStrategy();

  it('maps a valid admin payload to an AdminActor', () => {
    const actor = strategy.validate(basePayload);
    expect(actor).toEqual({
      id: 'admin-1',
      email: 'a@b.com',
      roles: ['operator'],
      tenantIds: [],
    });
  });

  it('rejects a non-admin typ (e.g. a conversation token)', () => {
    expect(() => strategy.validate({ ...basePayload, typ: 'conversation' })).toThrow(AppError);
  });

  it('rejects a payload missing sub', () => {
    expect(() => strategy.validate({ ...basePayload, sub: '' })).toThrow(AppError);
  });

  it('rejects a payload with non-array roles', () => {
    expect(() =>
      strategy.validate({ ...basePayload, roles: undefined as unknown as string[] }),
    ).toThrow(AppError);
  });

  it('defaults tenantIds to [] when tenant_ids is absent', () => {
    const { tenant_ids, ...rest } = basePayload;
    void tenant_ids;
    const actor = strategy.validate(rest as AdminJwtPayload);
    expect(actor.tenantIds).toEqual([]);
  });
});
