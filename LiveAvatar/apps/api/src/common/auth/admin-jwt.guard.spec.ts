import { AppError } from '../errors/app-error';
import { AdminJwtGuard } from './admin-jwt.guard';

describe('AdminJwtGuard', () => {
  const guard = new AdminJwtGuard();

  it('returns the user on success', () => {
    const user = { id: '1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('rethrows an AppError unchanged', () => {
    const err = AppError.unauthorized('AUTH_REFRESH_INVALID');
    expect(() => guard.handleRequest(err, null)).toThrow(err);
  });

  it('maps a non-AppError failure to AUTH_UNAUTHORIZED', () => {
    try {
      guard.handleRequest(new Error('boom'), null);
      fail('expected throw');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe('AUTH_UNAUTHORIZED');
    }
  });

  it('maps a missing user (no error) to AUTH_UNAUTHORIZED', () => {
    expect(() => guard.handleRequest(null, null)).toThrow(AppError);
  });
});
