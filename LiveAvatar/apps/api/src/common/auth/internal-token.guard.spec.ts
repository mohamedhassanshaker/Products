import type { ExecutionContext } from '@nestjs/common';
import { InternalTokenGuard } from './internal-token.guard';

function makeContext(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalTokenGuard', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, INTERNAL_TOKEN: 'a-real-internal-token-value' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('allows a request whose X-Internal-Token matches INTERNAL_TOKEN exactly', () => {
    const guard = new InternalTokenGuard();
    const ctx = makeContext({ 'x-internal-token': 'a-real-internal-token-value' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a missing X-Internal-Token header', () => {
    const guard = new InternalTokenGuard();
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(expect.objectContaining({ code: 'AUTH_UNAUTHORIZED' }));
  });

  it('rejects a mismatched token of the same length', () => {
    const guard = new InternalTokenGuard();
    const ctx = makeContext({ 'x-internal-token': 'b-real-internal-token-value' });
    expect(() => guard.canActivate(ctx)).toThrow(expect.objectContaining({ code: 'AUTH_UNAUTHORIZED' }));
  });

  it('rejects a mismatched token of a different length (exercises the length-mismatch branch)', () => {
    const guard = new InternalTokenGuard();
    const ctx = makeContext({ 'x-internal-token': 'short' });
    expect(() => guard.canActivate(ctx)).toThrow(expect.objectContaining({ code: 'AUTH_UNAUTHORIZED' }));
  });

  it('rejects when INTERNAL_TOKEN is not configured at all', () => {
    delete process.env.INTERNAL_TOKEN;
    const guard = new InternalTokenGuard();
    const ctx = makeContext({ 'x-internal-token': 'anything' });
    expect(() => guard.canActivate(ctx)).toThrow(expect.objectContaining({ code: 'AUTH_UNAUTHORIZED' }));
  });

  it('rejects a non-string header value (e.g. an array from a duplicated header)', () => {
    const guard = new InternalTokenGuard();
    const ctx = makeContext({} as never);
    (ctx.switchToHttp().getRequest() as { headers: Record<string, unknown> }).headers['x-internal-token'] = [
      'a-real-internal-token-value',
    ];
    expect(() => guard.canActivate(ctx)).toThrow(expect.objectContaining({ code: 'AUTH_UNAUTHORIZED' }));
  });
});
