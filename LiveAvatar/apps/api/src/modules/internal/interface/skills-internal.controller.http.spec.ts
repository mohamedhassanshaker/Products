import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import { GetSkillBodyUseCase } from '../../skills';
import { SkillsInternalController } from './skills-internal.controller';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { AppExceptionFilter } from '../../../common/errors/app-exception.filter';

/**
 * Real HTTP pipeline test (mirrors `knowledge-internal.controller.http.spec.ts`'s
 * precedent exactly) — drives the actual wired `@UseGuards(InternalTokenGuard)`
 * instance via `@nestjs/testing` + `supertest`, mocking only the use-case
 * layer. This is the security review's own evidence that a missing/wrong
 * `X-Internal-Token` cannot fall through to a real skill-body read (call
 * count asserted at zero) — the phase's own named "verify with a real test,
 * not just code inspection" requirement for this endpoint.
 */
describe('SkillsInternalController — real HTTP pipeline (guard)', () => {
  let app: INestApplication;
  const TOKEN = 'e2e-internal-token-at-least-16-chars';

  const getSkillBody = { execute: jest.fn() };

  beforeAll(async () => {
    process.env.INTERNAL_TOKEN = TOKEN;

    const moduleRef = await Test.createTestingModule({
      controllers: [SkillsInternalController],
      providers: [
        InternalTokenGuard,
        { provide: GetSkillBodyUseCase, useValue: getSkillBody },
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
    getSkillBody.execute.mockResolvedValue({
      id: 'skill-1',
      version: 1,
      name: 'Refunds',
      description: 'Handle refunds',
      instructions: 'Do the refund thing',
      trigger_mode: 'model',
      tool_definitions: [],
      knowledge_filters: { source_refs: [] },
      budget_ms: 1500,
    });
  });

  it('rejects with 401 and never calls the use-case when no X-Internal-Token is sent', async () => {
    await request(app.getHttpServer()).get('/internal/skills/skill-1/versions/1/body').expect(401);
    expect(getSkillBody.execute).not.toHaveBeenCalled();
  });

  it('rejects with 401 and never calls the use-case when a wrong token is sent', async () => {
    await request(app.getHttpServer())
      .get('/internal/skills/skill-1/versions/1/body')
      .set('X-Internal-Token', 'wrong-token-wrong-token')
      .expect(401);
    expect(getSkillBody.execute).not.toHaveBeenCalled();
  });

  it('accepts a real request with a valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/internal/skills/skill-1/versions/1/body')
      .set('X-Internal-Token', TOKEN)
      .expect(200);
    expect(getSkillBody.execute).toHaveBeenCalledWith('skill-1', 1);
    expect(res.body.instructions).toBe('Do the refund thing');
  });

  it('rejects a non-numeric version segment with 404, even with a valid token, without calling the use-case', async () => {
    await request(app.getHttpServer())
      .get('/internal/skills/skill-1/versions/not-a-number/body')
      .set('X-Internal-Token', TOKEN)
      .expect(404);
    expect(getSkillBody.execute).not.toHaveBeenCalled();
  });
});
