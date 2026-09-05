import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import { SearchKnowledgeUseCase, RecordKnowledgeGapUseCase } from '../../knowledge';
import { KnowledgeInternalController } from './knowledge-internal.controller';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { AppExceptionFilter } from '../../../common/errors/app-exception.filter';

/**
 * Real HTTP pipeline test (mirrors `agent-internal.controller.http.spec.ts`'s
 * precedent exactly) — drives the actual wired `@UseGuards(InternalTokenGuard)`
 * + `TypeBoxValidationPipe` instances via `@nestjs/testing` + `supertest`,
 * mocking only the use-case layer. This is the security review's own
 * evidence that a missing/wrong `X-Internal-Token` cannot fall through to a
 * real hybrid-search/gap-write call (call count asserted at zero).
 */
describe('KnowledgeInternalController — real HTTP pipeline (guard + TypeBoxValidationPipe)', () => {
  let app: INestApplication;
  const TOKEN = 'e2e-internal-token-at-least-16-chars';

  const searchKnowledge = { execute: jest.fn() };
  const recordGap = { execute: jest.fn() };

  beforeAll(async () => {
    process.env.INTERNAL_TOKEN = TOKEN;

    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeInternalController],
      providers: [
        InternalTokenGuard,
        { provide: SearchKnowledgeUseCase, useValue: searchKnowledge },
        { provide: RecordKnowledgeGapUseCase, useValue: recordGap },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    searchKnowledge.execute.mockResolvedValue({ candidates: [] });
    recordGap.execute.mockResolvedValue(undefined);
  });

  const validSearchBody = {
    tenant_id: '11111111-1111-1111-1111-111111111111',
    source_refs: ['22222222-2222-2222-2222-222222222222'],
    query_text: 'refund after 30 days',
    query_embedding: [0.1, 0.2, 0.3],
    vector_weight: 0.6,
    keyword_weight: 0.4,
    candidates: 20,
  };

  const validGapBody = {
    tenant_id: '11111111-1111-1111-1111-111111111111',
    query: 'refund after 30 days',
  };

  it('rejects /internal/knowledge/search with 401 and never calls the use-case when no X-Internal-Token is sent', async () => {
    await request(app.getHttpServer()).post('/internal/knowledge/search').send(validSearchBody).expect(401);
    expect(searchKnowledge.execute).not.toHaveBeenCalled();
  });

  it('rejects /internal/knowledge/search with 401 and never calls the use-case when a wrong token is sent', async () => {
    await request(app.getHttpServer())
      .post('/internal/knowledge/search')
      .set('X-Internal-Token', 'wrong-token-wrong-token')
      .send(validSearchBody)
      .expect(401);
    expect(searchKnowledge.execute).not.toHaveBeenCalled();
  });

  it('accepts a spec-shaped /internal/knowledge/search request with a valid token', async () => {
    await request(app.getHttpServer())
      .post('/internal/knowledge/search')
      .set('X-Internal-Token', TOKEN)
      .send(validSearchBody)
      .expect(200);
    expect(searchKnowledge.execute).toHaveBeenCalledWith(validSearchBody);
  });

  it('rejects /internal/knowledge/gaps with 401 and never calls the use-case when no token is sent', async () => {
    await request(app.getHttpServer()).post('/internal/knowledge/gaps').send(validGapBody).expect(401);
    expect(recordGap.execute).not.toHaveBeenCalled();
  });

  it('rejects /internal/knowledge/gaps with 401 and never calls the use-case when a wrong token is sent', async () => {
    await request(app.getHttpServer())
      .post('/internal/knowledge/gaps')
      .set('X-Internal-Token', 'wrong-token-wrong-token')
      .send(validGapBody)
      .expect(401);
    expect(recordGap.execute).not.toHaveBeenCalled();
  });

  it('accepts a spec-shaped /internal/knowledge/gaps request with a valid token', async () => {
    await request(app.getHttpServer())
      .post('/internal/knowledge/gaps')
      .set('X-Internal-Token', TOKEN)
      .send(validGapBody)
      .expect(204);
    expect(recordGap.execute).toHaveBeenCalledWith(validGapBody);
  });

  it('rejects a malformed body (missing query_embedding) with 400, even with a valid token', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/knowledge/search')
      .set('X-Internal-Token', TOKEN)
      .send({ ...validSearchBody, query_embedding: undefined })
      .expect(400);
    expect(res.body.error.code).toBe('INTERNAL_PAYLOAD_INVALID');
    expect(searchKnowledge.execute).not.toHaveBeenCalled();
  });

  it("rejects a metadata filter field that doesn't match the allow-listed pattern with 400 (defense in depth before the raw-SQL layer)", async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/knowledge/search')
      .set('X-Internal-Token', TOKEN)
      .send({ ...validSearchBody, filter: { field: "section'; DROP TABLE knowledge_chunk; --", op: 'eq', value: 'refunds' } })
      .expect(400);
    expect(res.body.error.code).toBe('INTERNAL_PAYLOAD_INVALID');
    expect(searchKnowledge.execute).not.toHaveBeenCalled();
  });
});
