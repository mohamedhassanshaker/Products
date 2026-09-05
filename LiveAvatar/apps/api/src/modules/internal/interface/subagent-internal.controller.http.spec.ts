import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import { GetSubAgentPersonaUseCase } from '../../deployment-config';
import { SubAgentInternalController } from './subagent-internal.controller';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { AppExceptionFilter } from '../../../common/errors/app-exception.filter';

/**
 * Real HTTP pipeline test (Phase 15, BL-058) — mirrors
 * `skills-internal.controller.http.spec.ts`'s precedent exactly: drives the
 * actual wired `@UseGuards(InternalTokenGuard)` instance via
 * `@nestjs/testing` + `supertest`, mocking only the use-case layer.
 */
describe('SubAgentInternalController — real HTTP pipeline (guard)', () => {
  let app: INestApplication;
  const TOKEN = 'e2e-internal-token-at-least-16-chars';

  const getSubAgentPersona = { execute: jest.fn() };

  beforeAll(async () => {
    process.env.INTERNAL_TOKEN = TOKEN;

    const moduleRef = await Test.createTestingModule({
      controllers: [SubAgentInternalController],
      providers: [
        InternalTokenGuard,
        { provide: GetSubAgentPersonaUseCase, useValue: getSubAgentPersona },
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
    getSubAgentPersona.execute.mockResolvedValue({
      tenant_id: 'tenant-b',
      system_prompt: 'You are a billing specialist.',
      tool_definitions: [],
    });
  });

  it('rejects with 401 and never calls the use-case when no X-Internal-Token is sent', async () => {
    await request(app.getHttpServer()).get('/internal/tenants/tenant-b/subagent-persona').expect(401);
    expect(getSubAgentPersona.execute).not.toHaveBeenCalled();
  });

  it('rejects with 401 and never calls the use-case when a wrong token is sent', async () => {
    await request(app.getHttpServer())
      .get('/internal/tenants/tenant-b/subagent-persona')
      .set('X-Internal-Token', 'wrong-token-wrong-token')
      .expect(401);
    expect(getSubAgentPersona.execute).not.toHaveBeenCalled();
  });

  it('accepts a real request with a valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/internal/tenants/tenant-b/subagent-persona')
      .set('X-Internal-Token', TOKEN)
      .expect(200);
    expect(getSubAgentPersona.execute).toHaveBeenCalledWith('tenant-b');
    expect(res.body.system_prompt).toBe('You are a billing specialist.');
  });
});
