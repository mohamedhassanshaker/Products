import { of } from 'rxjs';
import { TenantContext } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';

function makeContext(params: Record<string, string>) {
  return { switchToHttp: () => ({ getRequest: () => ({ params }) }) } as never;
}

describe('TenantContextInterceptor', () => {
  const interceptor = new TenantContextInterceptor();

  it('binds TenantContext for the handler and unbinds after', async () => {
    let sawInside: unknown;
    const next = {
      handle: () =>
        of(
          (() => {
            sawInside = TenantContext.get();
            return 'result';
          })(),
        ),
    };
    const result$ = await interceptor.intercept(makeContext({ id: 'tenant-1' }), next);
    const value = await new Promise((resolve) => result$.subscribe(resolve));
    expect(value).toBe('result');
    expect(sawInside).toEqual({ tenantId: 'tenant-1', bypass: false });
    expect(TenantContext.get()).toBeUndefined();
  });

  it('uses null tenantId when no route param is present', async () => {
    let sawInside: unknown;
    const next = {
      handle: () =>
        of(
          (() => {
            sawInside = TenantContext.get();
            return 'ok';
          })(),
        ),
    };
    await interceptor.intercept(makeContext({}), next);
    expect(sawInside).toEqual({ tenantId: null, bypass: false });
  });
});
