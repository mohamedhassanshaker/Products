import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import {
  ApplySessionEventUseCase,
  GetRuntimeConfigUseCase,
  RecordAlertUseCase,
  RecordHopsUseCase,
  RecordUtterancesUseCase,
  SESSION_REPOSITORY,
  SetSessionSummaryUseCase,
} from '../../sessions';
import { RecordGpuHeartbeatUseCase } from '../../gpu';
import { AgentInternalController } from './agent-internal.controller';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { AppExceptionFilter } from '../../../common/errors/app-exception.filter';

/**
 * QA fix (phase4-api-internal D-1): the pre-existing
 * `agent-internal.controller.spec.ts` instantiates the controller directly
 * (`new AgentInternalController(...)`), which bypasses Nest's HTTP pipeline
 * entirely — the `TypeBoxValidationPipe`/`InternalTokenGuard` layer that
 * actually rejected every real `events`/`utterances` request (the
 * unregistered `date-time` format bug) was never exercised by any existing
 * test. This suite drives the REAL wired HTTP surface — `@nestjs/testing` +
 * `supertest` against the real `AgentInternalController` with its real
 * `@UseGuards(InternalTokenGuard)` and the real inline
 * `TypeBoxValidationPipe`/schema instances — mocking only the
 * repository/use-case layer (the Prisma-backed boundary), never the guard,
 * controller, or pipe. This is the class of bug this repo needs a permanent
 * regression guard for.
 */
describe('AgentInternalController — real HTTP pipeline (guard + TypeBoxValidationPipe)', () => {
  let app: INestApplication;
  const TOKEN = 'e2e-internal-token-at-least-16-chars';

  const sessions = { findById: jest.fn() };
  const getRuntimeConfig = { execute: jest.fn() };
  const applyEvent = { execute: jest.fn() };
  const recordUtterances = { execute: jest.fn() };
  const recordHops = { execute: jest.fn() };
  const setSummary = { execute: jest.fn() };
  const recordAlert = { execute: jest.fn() };
  const recordGpuHeartbeat = { execute: jest.fn() };

  beforeAll(async () => {
    process.env.INTERNAL_TOKEN = TOKEN;

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentInternalController],
      providers: [
        InternalTokenGuard,
        { provide: SESSION_REPOSITORY, useValue: sessions },
        { provide: GetRuntimeConfigUseCase, useValue: getRuntimeConfig },
        { provide: ApplySessionEventUseCase, useValue: applyEvent },
        { provide: RecordUtterancesUseCase, useValue: recordUtterances },
        { provide: RecordHopsUseCase, useValue: recordHops },
        { provide: SetSessionSummaryUseCase, useValue: setSummary },
        { provide: RecordAlertUseCase, useValue: recordAlert },
        { provide: RecordGpuHeartbeatUseCase, useValue: recordGpuHeartbeat },
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
    sessions.findById.mockResolvedValue({ id: 's1', tenantId: 't1' });
    applyEvent.execute.mockResolvedValue(undefined);
    recordUtterances.execute.mockResolvedValue(undefined);
  });

  it('rejects every route with 401 when no X-Internal-Token header is sent', async () => {
    await request(app.getHttpServer())
      .post('/internal/sessions/s1/events')
      .send({ type: 'active', at: '2026-01-01T00:00:00.000Z' })
      .expect(401);
  });

  it('D-1 regression: POST /internal/sessions/{id}/events accepts a spec-shaped payload (was 400 before the date-time format fix)', async () => {
    await request(app.getHttpServer())
      .post('/internal/sessions/s1/events')
      .set('X-Internal-Token', TOKEN)
      .send({ type: 'active', at: '2026-01-01T00:00:00.000Z' })
      .expect(204);

    expect(applyEvent.execute).toHaveBeenCalledWith(
      await sessions.findById('s1'),
      'active',
      undefined,
    );
  });

  it('D-1 regression: POST /internal/sessions/{id}/utterances accepts a spec-shaped payload with started_at/ended_at date-times', async () => {
    await request(app.getHttpServer())
      .post('/internal/sessions/s1/utterances')
      .set('X-Internal-Token', TOKEN)
      .send({
        items: [
          {
            seq: 0,
            role: 'user',
            text: 'hello',
            started_at: '2026-01-01T00:00:00.000Z',
            ended_at: '2026-01-01T00:00:01.500Z',
          },
        ],
      })
      .expect(204);

    expect(recordUtterances.execute).toHaveBeenCalledWith('s1', {
      items: [
        {
          seq: 0,
          role: 'user',
          text: 'hello',
          started_at: '2026-01-01T00:00:00.000Z',
          ended_at: '2026-01-01T00:00:01.500Z',
        },
      ],
    });
  });

  it('still rejects a genuinely malformed at value with 400 INTERNAL_PAYLOAD_INVALID', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/sessions/s1/events')
      .set('X-Internal-Token', TOKEN)
      .send({ type: 'active', at: 'not-a-date' })
      .expect(400);

    expect(res.body.error.code).toBe('INTERNAL_PAYLOAD_INVALID');
  });
});
