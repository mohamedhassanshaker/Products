import { JwtService } from '@nestjs/jwt';
import { JwtSigner } from './jwt.signer';
import type { AdminIdentity } from '../domain/admin-identity';

describe('JwtSigner', () => {
  const identity: AdminIdentity = {
    id: 'admin-1',
    email: 'a@b.com',
    passwordHash: 'x',
    roles: ['operator'],
    disabled: false,
    tenantIds: [],
  };

  it('signs an access token embedding the expected admin claims', () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    const jwt = new JwtService();
    const signer = new JwtSigner(jwt);
    const token = signer.signAccess(identity);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe('admin-1');
    expect(decoded.typ).toBe('admin');
    expect(decoded.roles).toEqual(['operator']);
  });
});
