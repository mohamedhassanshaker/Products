import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { KnowledgeSourcesController } from './knowledge-sources.controller';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { AdminJwtStrategy } from '../../../common/auth/admin-jwt.strategy';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { AppError } from '../../../common/errors/app-error';
import { AppExceptionFilter } from '../../../common/errors/app-exception.filter';
import { CreateKnowledgeSourceUseCase } from '../application/create-knowledge-source.use-case';
import { ListKnowledgeSourcesUseCase } from '../application/list-knowledge-sources.use-case';
import { GetKnowledgeSourceUseCase } from '../application/get-knowledge-source.use-case';
import { UpdateKnowledgeSourceUseCase } from '../application/update-knowledge-source.use-case';
import { DeleteKnowledgeSourceUseCase } from '../application/delete-knowledge-source.use-case';
import { EstimateReindexUseCase } from '../application/estimate-reindex.use-case';
import { TriggerReindexUseCase } from '../application/trigger-reindex.use-case';

/**
 * Real-HTTP-pipeline proof (mirrors `agent-internal.controller.http.spec.ts`'s
 * documented rationale): `@nestjs/testing` + supertest against the REAL
 * `@UseGuards(AdminJwtGuard, RolesGuard)` decorator and the real Passport
 * `admin-jwt` strategy — a directly-instantiated controller (see the sibling
 * `.spec.ts` in this directory) bypasses Nest's HTTP pipeline entirely and
 * never actually exercises a guard. Only the application/use-case layer is
 * mocked (`useValue`) — this suite's job is proving the guard chain, tenant
 * scoping's *auth precondition* lives at the use-case layer (see
 * `create-knowledge-source.use-case.spec.ts`'s "403s an admin not assigned
 * to the tenant", mirroring `create-tool.use-case.spec.ts` exactly).
 */
describe('KnowledgeSourcesController — real HTTP pipeline (guards)', () => {
  let app: INestApplication;
  const JWT_SECRET = 'knowledge-http-spec-secret-at-least-32-characters-long';
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  const listSources = { execute: jest.fn() };
  const getSource = { execute: jest.fn() };
  const createSource = { execute: jest.fn() };
  const updateSource = { execute: jest.fn() };
  const deleteSource = { execute: jest.fn() };
  const estimateReindex = { execute: jest.fn() };
  const triggerReindex = { execute: jest.fn() };

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
      controllers: [KnowledgeSourcesController],
      providers: [
        AdminJwtStrategy,
        AdminJwtGuard,
        RolesGuard,
        { provide: CreateKnowledgeSourceUseCase, useValue: createSource },
        { provide: ListKnowledgeSourcesUseCase, useValue: listSources },
        { provide: GetKnowledgeSourceUseCase, useValue: getSource },
        { provide: UpdateKnowledgeSourceUseCase, useValue: updateSource },
        { provide: DeleteKnowledgeSourceUseCase, useValue: deleteSource },
        { provide: EstimateReindexUseCase, useValue: estimateReindex },
        { provide: TriggerReindexUseCase, useValue: triggerReindex },
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

  it('rejects every route with 401 when no Authorization header is sent', async () => {
    await request(app.getHttpServer()).get('/tenants/tenant-1/knowledge-sources').expect(401);
    expect(listSources.execute).not.toHaveBeenCalled();
  });

  it('rejects a non-admin (e.g. conversation) JWT with 401 (FR-AUTH-5 — typ must be admin)', async () => {
    const token = signToken({ typ: 'conversation' });
    await request(app.getHttpServer())
      .get('/tenants/tenant-1/knowledge-sources')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a garbage bearer token with 401', async () => {
    await request(app.getHttpServer())
      .get('/tenants/tenant-1/knowledge-sources')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('accepts a valid admin JWT and delegates to the real use-case token, proving the guard chain lets a legitimate request through', async () => {
    listSources.execute.mockResolvedValue({ items: [] });
    const token = signToken();

    const res = await request(app.getHttpServer())
      .get('/tenants/tenant-1/knowledge-sources')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ items: [] });
    expect(listSources.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1', roles: ['operator'] }),
      'tenant-1',
    );
  });

  it('the real multer layer rejects an upload over the 10 MiB limit before it ever reaches the use-case (defense layer 1 of 2)', async () => {
    const token = signToken();
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');

    const res = await request(app.getHttpServer())
      .post('/tenants/tenant-1/knowledge-sources')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Docs')
      .attach('file', oversized, 'big.txt');

    // Multer enforces `limits.fileSize` itself, independent of
    // `assertUploadFile`'s own KNOWLEDGE_SOURCE_FILE_TOO_LARGE check (which
    // is exercised directly in `create-knowledge-source.use-case.spec.ts`,
    // defense layer 2 of 2) — this proves layer 1 actually rejects the
    // request before the controller method body (and therefore the
    // use-case) ever runs.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(createSource.execute).not.toHaveBeenCalled();
  });

  it('an authenticated request still surfaces a real application error through the real AppExceptionFilter', async () => {
    getSource.execute.mockRejectedValue(AppError.notFound('KNOWLEDGE_SOURCE_NOT_FOUND'));
    const token = signToken();

    const res = await request(app.getHttpServer())
      .get('/tenants/tenant-1/knowledge-sources/missing')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body.error.code).toBe('KNOWLEDGE_SOURCE_NOT_FOUND');
  });
});
