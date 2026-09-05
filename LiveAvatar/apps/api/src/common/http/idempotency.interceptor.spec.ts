import { of } from 'rxjs';
import { AppError } from '../errors/app-error';
import { TenantContext } from '../tenancy/tenant-context';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { hashRequestBody } from './stable-json';

const KEY = '11111111-1111-4111-8111-111111111111';

function makeContext(opts: {
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  user?: { id?: string };
}) {
  const headers = opts.headers ?? {};
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  const req = {
    method: opts.method,
    header: (name: string) => headers[name.toLowerCase()],
    body: opts.body,
    user: opts.user,
    route: { path: '/tenants' },
    path: '/tenants',
    log: { warn: jest.fn() },
  };
  return {
    ctx: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as never,
    req,
    res,
  };
}

describe('IdempotencyInterceptor', () => {
  function makePrisma() {
    const idempotencyRecord = { findFirst: jest.fn(), create: jest.fn() };
    return {
      prisma: {
        withBypass: jest.fn((fn: () => unknown) => fn()),
        idempotencyRecord,
      },
      idempotencyRecord,
    };
  }

  it('passes through non-mutating methods untouched', async () => {
    const { prisma } = makePrisma();
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx } = makeContext({ method: 'GET' });
    const next = { handle: () => of('result') };
    const result$ = await interceptor.intercept(ctx, next);
    expect(await lastValue(result$)).toBe('result');
  });

  it('passes through when no Idempotency-Key header is present', async () => {
    const { prisma } = makePrisma();
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx } = makeContext({ method: 'POST' });
    const next = { handle: () => of('result') };
    expect(await lastValue(await interceptor.intercept(ctx, next))).toBe('result');
  });

  it('rejects a non-UUID Idempotency-Key', async () => {
    const { prisma } = makePrisma();
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx } = makeContext({ method: 'POST', headers: { 'idempotency-key': 'not-a-uuid' } });
    const next = { handle: () => of('result') };
    await expect(interceptor.intercept(ctx, next)).rejects.toBeInstanceOf(AppError);
  });

  it('replays a stored response for the same key + same body', async () => {
    const { prisma, idempotencyRecord } = makePrisma();
    // Recompute the exact hash the interceptor will use for this body.
    const body = { name: 'Acme' };
    idempotencyRecord.findFirst.mockResolvedValue({
      requestHash: hashRequestBody(body),
      responseStatus: 201,
      responseBody: { id: '1' },
    });
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx, res } = makeContext({
      method: 'POST',
      headers: { 'idempotency-key': KEY },
      body,
    });
    const next = { handle: () => of('should-not-be-used') };
    const result$ = await interceptor.intercept(ctx, next);
    expect(await lastValue(result$)).toEqual({ id: '1' });
    expect(res.statusCode).toBe(201);
  });

  it('rejects replay with a different body under the same key', async () => {
    const { prisma, idempotencyRecord } = makePrisma();
    idempotencyRecord.findFirst.mockResolvedValue({
      requestHash: 'different-hash',
      responseStatus: 201,
      responseBody: {},
    });
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx } = makeContext({
      method: 'POST',
      headers: { 'idempotency-key': KEY },
      body: { name: 'Acme' },
    });
    const next = { handle: () => of('x') };
    await expect(interceptor.intercept(ctx, next)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('stores the response after a fresh request and tags it with the tenant scope', async () => {
    const { prisma, idempotencyRecord } = makePrisma();
    idempotencyRecord.findFirst.mockResolvedValue(null);
    idempotencyRecord.create.mockResolvedValue({});
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx, res } = makeContext({
      method: 'POST',
      headers: { 'idempotency-key': KEY },
      body: { name: 'Acme' },
      user: { id: 'admin-1' },
    });
    res.statusCode = 201;
    const next = { handle: () => of({ id: 'new' }) };
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, async () => {
      const result$ = await interceptor.intercept(ctx, next);
      expect(await lastValue(result$)).toEqual({ id: 'new' });
    });
    await flushMicrotasks();
    expect(idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', responseStatus: 201 }),
      }),
    );
  });

  it('does not fail the request when persisting the idempotency record fails', async () => {
    const { prisma, idempotencyRecord } = makePrisma();
    idempotencyRecord.findFirst.mockResolvedValue(null);
    idempotencyRecord.create.mockRejectedValue(new Error('disk full'));
    const interceptor = new IdempotencyInterceptor(prisma as never);
    const { ctx, req } = makeContext({
      method: 'POST',
      headers: { 'idempotency-key': KEY },
      body: { name: 'Acme' },
    });
    const next = { handle: () => of({ id: 'new' }) };
    const result$ = await interceptor.intercept(ctx, next);
    expect(await lastValue(result$)).toEqual({ id: 'new' });
    await flushMicrotasks();
    expect(req.log.warn).toHaveBeenCalled();
  });
});

function lastValue<T>(obs: { subscribe: (fn: (v: T) => void) => void }): Promise<T> {
  return new Promise((resolve) => obs.subscribe(resolve));
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
