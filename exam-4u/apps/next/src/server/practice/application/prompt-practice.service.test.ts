import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import { CurriculumNotFoundError } from '@/server/curricula';
import { PromptPracticeService } from './prompt-practice.service';
import { AiDisabledError } from '@/server/ai';
import { EmptyPromptError, InvalidQuestionCountError } from '../domain/errors';

const TENANT_ID = 't-1';
const USER_ID = 'u-1';

function withScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: TENANT_ID, userId: USER_ID }, fn);
}

function makeService(overrides: { promptPracticeResult?: unknown; curriculum?: unknown; aiAvailable?: boolean } = {}) {
  const aiService = {
    // `available: true` by default — this dispatch's own AI-outage-isolation e2e proof
    // (Phase 10 sub-slice "10b1") added a fail-fast `!aiService.available` check to
    // `PromptPracticeService.generate` (see that method's own doc comment), so this fake must
    // reflect the "AI enabled" case unless a test explicitly overrides it to prove the new
    // AiDisabledError short-circuit.
    available: overrides.aiAvailable ?? true,
    promptPractice: vi.fn().mockResolvedValue(
      overrides.promptPracticeResult ?? {
        data: [{ questionText: 'Q1', options: [{ key: 'A', text: 'a' }], correctAnswer: 'A', explanation: 'e', bloomsLevel: 2 }],
        usage: { model: 'm', promptTokens: 1, completionTokens: 1, costUsd: 0, costUnavailable: false, latencyMs: 1, attempts: 1 },
        droppedItems: 0,
      },
    ),
  };
  const retrieval = { retrieve: vi.fn().mockResolvedValue([]) };
  const curricula = {
    findById: vi.fn().mockResolvedValue(overrides.curriculum === undefined ? { id: 'c-1', ownerUserId: USER_ID, subjectId: 1 } : overrides.curriculum),
  };
  const service = new PromptPracticeService(aiService as never, retrieval as never, curricula as never);
  return { service, aiService, retrieval, curricula };
}

describe('PromptPracticeService.generate (FR-CUR-5)', () => {
  it('throws EmptyPromptError for a whitespace-only prompt, before any DB/AI call', async () => {
    const { service, curricula, aiService } = makeService();
    await withScope(() => expect(service.generate({ curriculumId: 'c-1', prompt: '   ', count: 5 })).rejects.toThrow(EmptyPromptError));
    expect(curricula.findById).not.toHaveBeenCalled();
    expect(aiService.promptPractice).not.toHaveBeenCalled();
  });

  // Phase 10 sub-slice "10b1" (real e2e AI-outage-isolation proof against a fresh, cold-volume
  // container) found that this method used to call `retrieval.retrieve` (a real embeddings-network
  // call, entirely outside `AiServicePort`'s own `AI_ENABLED` gate) BEFORE ever reaching
  // `aiService.promptPractice` — the one call that actually threw `AiDisabledError`. That meant a real
  // embeddings-provider failure surfaced as a raw, uncaught 500 instead of the intended, documented
  // `AiDisabledError`/`503 AI_DISABLED`. This test locks in the fix: AI-disabled must be detected and
  // thrown BEFORE any retrieval/embeddings call is ever attempted.
  it('throws AiDisabledError immediately when AI is disabled, WITHOUT ever calling retrieval/embeddings (Phase 10 sub-slice "10b1" regression test)', async () => {
    const { service, retrieval, aiService } = makeService({ aiAvailable: false });
    await withScope(() => expect(service.generate({ curriculumId: 'c-1', prompt: 'Anything', count: 3 })).rejects.toThrow(AiDisabledError));
    expect(retrieval.retrieve).not.toHaveBeenCalled();
    expect(aiService.promptPractice).not.toHaveBeenCalled();
  });

  it('throws InvalidQuestionCountError for count outside [1,30]', async () => {
    const { service } = makeService();
    await withScope(() => expect(service.generate({ curriculumId: 'c-1', prompt: 'topic', count: 0 })).rejects.toThrow(InvalidQuestionCountError));
    await withScope(() => expect(service.generate({ curriculumId: 'c-1', prompt: 'topic', count: 31 })).rejects.toThrow(InvalidQuestionCountError));
  });

  it('throws CurriculumNotFoundError when the curriculum does not exist', async () => {
    const { service } = makeService({ curriculum: null });
    await withScope(() => expect(service.generate({ curriculumId: 'missing', prompt: 'topic', count: 5 })).rejects.toThrow(CurriculumNotFoundError));
  });

  it('throws CurriculumNotFoundError (not a distinct ownership error) when the curriculum belongs to another user', async () => {
    const { service } = makeService({ curriculum: { id: 'c-1', ownerUserId: 'someone-else', subjectId: 1 } });
    await withScope(() => expect(service.generate({ curriculumId: 'c-1', prompt: 'topic', count: 5 })).rejects.toThrow(CurriculumNotFoundError));
  });

  it('returns a failed-session result (not a thrown error) when the AI call yields zero usable questions', async () => {
    const { service } = makeService({ promptPracticeResult: { data: [], usage: {}, droppedItems: 2 } });
    const result = await withScope(() => service.generate({ curriculumId: 'c-1', prompt: 'topic', count: 5 }));
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('returns completed questions, never including a confidence field on the wire', async () => {
    const { service } = makeService();
    const result = await withScope(() => service.generate({ curriculumId: 'c-1', prompt: 'topic', count: 1 }));
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]).not.toHaveProperty('confidenceScore');
      expect(result.questions[0].questionText).toBe('Q1');
    }
  });
});
