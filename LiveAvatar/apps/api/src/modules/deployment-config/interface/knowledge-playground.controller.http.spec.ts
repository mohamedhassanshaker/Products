import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { KnowledgePlaygroundController } from './knowledge-playground.controller';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { AdminJwtStrategy } from '../../../common/auth/admin-jwt.strategy';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { AppError } from '../../../common/errors/app-error';
import { AppExceptionFilter } from '../../../common/errors/app-exception.filter';
import { RunRetrievalPlaygroundUseCase } from '../application/run-retrieval-playground.use-case';

/**
 * Real-HTTP-pipeline proof (mirrors `knowledge-sources.controller.http.spec.ts`'s
 * documented rationale exactly): `@nestjs/testing` + supertest against the
 * REAL `@UseGuards(AdminJwtGuard, RolesGuard)` decorator and the real
 * Passport `admin-jwt` strategy — a directly-instantiated controller
 * bypasses Nest's HTTP pipeline entirely and never actually exercises a
 * guard. Only the use-case layer is mocked.
 */
describe('KnowledgePlaygroundController — real HTTP pipeline (guards)', () => {
  let app: INestApplication;
  const JWT_SECRET = 'knowledge-playground-http-spec-secret-at-least-32-chars';
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  const runPlayground = { execute: jest.fn() };

  function signToken(overrides: Partial<{ sub: string; email: string; roles: string[]; tenant_ids: string[]; typ: string }> = {}) {
    const jwt = new JwtService({ secret: JWT_SECRET });
    return jwt.sign(
      { sub: 'admin-1', email: 'a@b.com', roles: ['operator'], tenant_ids: [], typ: 'admin', ...overrides },
      { expiresIn: '1h' },
    );
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = JWT_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'admin-jwt' })],
      controllers: [KnowledgePlaygroundController],
      providers: [
        AdminJwtStrategy,
        AdminJwtGuard,
        RolesGuard,
        { provide: RunRetrievalPlaygroundUseCase, useValue: runPlayground },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env.JWT_ACCESS_SECRET = originalSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validBody = { query: 'refund after 30 days' };

  it('rejects with 401 when no Authorization header is sent, and never calls the use-case', async () => {
    await request(app.getHttpServer()).post('/tenants/tenant-1/knowledge/playground/run').send(validBody).expect(401);
    expect(runPlayground.execute).not.toHaveBeenCalled();
  });

  it('rejects a non-admin JWT with 401', async () => {
    const token = signToken({ typ: 'conversation' });
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/knowledge/playground/run')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody)
      .expect(401);
    expect(runPlayground.execute).not.toHaveBeenCalled();
  });

  it('rejects a garbage bearer token with 401', async () => {
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/knowledge/playground/run')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .send(validBody)
      .expect(401);
    expect(runPlayground.execute).not.toHaveBeenCalled();
  });

  it('accepts a valid admin JWT and delegates to the real use-case, proving the guard chain lets a legitimate request through', async () => {
    runPlayground.execute.mockResolvedValue({
      rewrite: { enabled: false, rewritten_query: null, ms: 0, timed_out: false },
      hybrid_search: { candidates: [], ms: 0, timed_out: false },
      filter: { enabled: false, before_count: 0, after_count: 0, ms: 0 },
      rerank: { enabled: false, note: 'not available' },
      threshold: { min_score: 0.5, pass_count: 0, dropped_count: 0, ms: 0 },
      inject: { chunks: [], token_total: 0, token_cap: 1200, ms: 0 },
      total_ms: 0,
      budget_ms: 400,
      over_budget: false,
    });
    const token = signToken();

    const res = await request(app.getHttpServer())
      .post('/tenants/tenant-1/knowledge/playground/run')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody)
      .expect(200);

    expect(res.body.budget_ms).toBe(400);
    expect(runPlayground.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1', roles: ['operator'] }),
      'tenant-1',
      expect.objectContaining({ query: 'refund after 30 days' }),
    );
  });

  it('rejects an empty query with 400 before ever calling the use-case', async () => {
    const token = signToken();
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/knowledge/playground/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '' })
      .expect(400);
    expect(runPlayground.execute).not.toHaveBeenCalled();
  });

  it('an authenticated request still surfaces a real application error through the real AppExceptionFilter', async () => {
    runPlayground.execute.mockRejectedValue(AppError.notFound('TENANT_NOT_FOUND'));
    const token = signToken();

    const res = await request(app.getHttpServer())
      .post('/tenants/tenant-1/knowledge/playground/run')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody)
      .expect(404);

    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });
});
