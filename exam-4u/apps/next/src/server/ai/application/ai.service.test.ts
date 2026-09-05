import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiModelSelection } from '@/server/platform/ai-models';
import { AiContractViolationError, AiDisabledError, AiServiceUnavailableError } from '../domain/errors';
import type { AiInvocationContext } from '../domain/ai-service.port';
import type { AiUsageRecorderPort } from '../domain/ai-usage-recorder.port';

/** Mocks `resolveModelForTenant` (always resolves the same fixed model — this suite is testing
 * `AiService.invoke()`'s own discipline, not `AiModelResolver`'s, which already has its own
 * dedicated suite under `server/platform/ai-models`). */
const resolveModelForTenant = vi.fn<() => Promise<AiModelSelection>>();
vi.mock('../ai-model-resolver', () => ({ resolveModelForTenant: (...args: unknown[]) => resolveModelForTenant(...(args as [])) }));

/** Mocks `runAiCall` (the ADK/OpenRouter boundary) and re-exports the real `AiRunnerCallError` class
 * (a plain `Error` subclass — safe to import for real rather than faking, and needed so
 * `instanceof` checks inside `ai.service.ts` behave correctly against instances this suite
 * constructs). */
const runAiCall = vi.fn();
vi.mock('../ai-runner', async () => {
  const actual = await vi.importActual<typeof import('../ai-runner')>('../ai-runner');
  return { ...actual, runAiCall: (...args: unknown[]) => runAiCall(...args) };
});

// Imported AFTER the mocks above so the mocked modules are in place before `ai.service.ts` resolves
// its own imports.
const { AiService } = await import('./ai.service');
const { AiRunnerCallError } = await import('../ai-runner');

const FIXED_MODEL: AiModelSelection = { source: 'platform_default', primary: { openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude 3.5 Haiku' } };

function ctx(overrides: Partial<AiInvocationContext> = {}): AiInvocationContext {
  return { tenantId: 't1', correlationId: 'corr-1', budget: { tokensRemaining: 1000, costRemainingUsd: 1 }, ...overrides };
}

function fakeRecorder(): AiUsageRecorderPort & { record: ReturnType<typeof vi.fn> } {
  return { record: vi.fn() };
}

const VALID_QUESTION = {
  questionText: 'What produces energy in a cell?',
  options: [
    { key: 'A', text: 'Mitochondria' },
    { key: 'B', text: 'Nucleus' },
    { key: 'C', text: 'Ribosome' },
    { key: 'D', text: 'Golgi apparatus' },
  ],
  correctAnswer: 'A',
  explanation: 'The mitochondria produces ATP.',
  bloomsLevel: 1,
  modelConfidence: 0.9,
  concept: 'cell biology',
};

describe('AiService', () => {
  beforeEach(() => {
    resolveModelForTenant.mockReset();
    resolveModelForTenant.mockResolvedValue(FIXED_MODEL);
    runAiCall.mockReset();
    delete process.env.AI_ENABLED;
    // `getEnv()` caches on `globalThis` — must be cleared so a test's own `process.env.AI_ENABLED`
    // mutation actually takes effect (see `server/config/index.ts`'s own doc comment on why it's
    // cached this way).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only globalThis reset, matches this app's own established `__examland*` singleton-cache convention.
    delete (globalThis as any).__examlandEnv;
  });

  afterEach(() => {
    delete process.env.AI_ENABLED;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  it('AI_ENABLED=false fails every operation closed with AiDisabledError WITHOUT calling runAiCall (no network I/O attempted)', async () => {
    process.env.AI_ENABLED = 'false';
    const service = new AiService(fakeRecorder());

    await expect(service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx())).rejects.toBeInstanceOf(AiDisabledError);
    expect(runAiCall).not.toHaveBeenCalled();
    expect(resolveModelForTenant).not.toHaveBeenCalled();
  });

  it('a successful call returns validated data and records usage with ok=true', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify([VALID_QUESTION]), usage: { promptTokens: 100, completionTokens: 50 }, finishReason: 'STOP' });
    const recorder = fakeRecorder();
    const service = new AiService(recorder);

    const result = await service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx());

    expect(result.data).toHaveLength(1);
    expect(result.droppedItems).toBe(0);
    expect(result.usage.model).toBe('anthropic/claude-3.5-haiku');
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ ok: true, droppedItems: 0, tenantId: 't1' }));
  });

  it('an unparseable model response is a soft success (droppedItems=1, data undefined), not a thrown error', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: 'not valid json at all', usage: { promptTokens: 10, completionTokens: 5 } });
    const recorder = fakeRecorder();
    const service = new AiService(recorder);

    const result = await service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx());

    expect(result.data).toBeUndefined();
    expect(result.droppedItems).toBe(1);
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ ok: false, droppedItems: 1 }));
    expect(runAiCall).toHaveBeenCalledTimes(1); // not retried
  });

  it('tolerates a markdown-code-fenced JSON response (some models wrap JSON even when asked not to)', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: '```json\n' + JSON.stringify([VALID_QUESTION]) + '\n```', usage: { promptTokens: 10, completionTokens: 5 } });
    const service = new AiService(fakeRecorder());

    const result = await service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx());
    expect(result.data).toHaveLength(1);
  });

  it('a schema-invalid (but parseable) JSON response throws AiContractViolationError, not retried', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify([{ wrong: 'shape' }]), usage: { promptTokens: 10, completionTokens: 5 } });
    const service = new AiService(fakeRecorder());

    await expect(service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx())).rejects.toBeInstanceOf(AiContractViolationError);
    expect(runAiCall).toHaveBeenCalledTimes(1); // not retried
  });

  it('a 401 AiRunnerCallError is classified non-retryable — exactly one attempt, then AiServiceUnavailableError(nonRetryable=true)', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockRejectedValue(new AiRunnerCallError('OpenRouter responded 401: {"error":{"message":"No cookie auth credentials found","code":401}}', 401));
    const service = new AiService(fakeRecorder());

    let caught: unknown;
    try {
      await service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiServiceUnavailableError);
    expect((caught as AiServiceUnavailableError).nonRetryable).toBe(true);
    expect(runAiCall).toHaveBeenCalledTimes(1); // never retried — matches OUR_BUG_ENGINE_CODES classification
  });

  it('a transport failure with no HTTP status is retried up to the attempt budget (3), then throws', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));
    const service = new AiService(fakeRecorder());

    await expect(service.promptPractice({ prompt: 'cells', count: 1, grounding: [] }, ctx())).rejects.toBeInstanceOf(AiServiceUnavailableError);
    expect(runAiCall).toHaveBeenCalledTimes(3);
  });

  it('5 consecutive transport failures open the circuit breaker; the 6th call never reaches runAiCall', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockRejectedValue(new Error('fetch failed'));
    const service = new AiService(fakeRecorder());

    // Each `promptPractice` call itself retries 3x internally; 2 calls = 6 failures >= breaker
    // threshold (5), so the breaker opens partway through the 2nd call.
    await expect(service.promptPractice({ prompt: 'a', count: 1, grounding: [] }, ctx())).rejects.toBeInstanceOf(AiServiceUnavailableError);
    await expect(service.promptPractice({ prompt: 'b', count: 1, grounding: [] }, ctx())).rejects.toBeInstanceOf(AiServiceUnavailableError);

    const callsSoFar = runAiCall.mock.calls.length;
    expect(callsSoFar).toBeGreaterThanOrEqual(5);

    runAiCall.mockClear();
    await expect(service.promptPractice({ prompt: 'c', count: 1, grounding: [] }, ctx())).rejects.toThrow(/circuit breaker is open/);
    expect(runAiCall).not.toHaveBeenCalled();
  });

  it('getReadiness reports "up"/closed initially and never throws or performs I/O', () => {
    const service = new AiService(fakeRecorder());
    const readiness = service.getReadiness();
    expect(readiness.state).toBe('up');
  });

  it('classifyContent genuinely calls runAiCall and returns validated data', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify({ contentType: 'lesson', topics: ['cells'], estimatedQuestionsPerPage: 3 }), usage: { promptTokens: 1, completionTokens: 1 } });
    const service = new AiService(fakeRecorder());

    const result = await service.classifyContent({ sampleText: 'The cell is the basic unit of life.', fileName: 'bio.pdf' }, ctx());
    expect(result.data.contentType).toBe('lesson');
    expect(runAiCall).toHaveBeenCalledWith(expect.objectContaining({ operation: 'classify-content' }));
  });

  it('generateLessonBatch genuinely calls runAiCall with the excerpt/coveredConcepts/grounding folded into the user message', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify([VALID_QUESTION]), usage: { promptTokens: 1, completionTokens: 1 } });
    const service = new AiService(fakeRecorder());

    const result = await service.generateLessonBatch(
      {
        excerpt: 'Mitochondria produce ATP.',
        sourceSection: 'Chapter 3',
        pageRange: '10-12',
        targetQuestionCount: 2,
        coveredConcepts: ['photosynthesis'],
        grounding: [{ text: 'grounding text', fileName: 'g.txt', pageNumber: 2, score: 0.8 }],
      },
      ctx(),
    );
    expect(result.data).toHaveLength(1);
    const call = runAiCall.mock.calls[0][0] as { userMessage: string; operation: string };
    expect(call.operation).toBe('generate-lesson-batch');
    expect(call.userMessage).toContain('Mitochondria produce ATP.');
    expect(call.userMessage).toContain('photosynthesis');
    expect(call.userMessage).toContain('grounding text');
  });

  it('extractExamPage genuinely calls runAiCall with pageText/answerKeyHints/grounding folded into the user message', async () => {
    process.env.AI_ENABLED = 'true';
    const extracted = { ...VALID_QUESTION, answerSource: 'provided', groundingStrength: 'strong' };
    runAiCall.mockResolvedValue({ text: JSON.stringify([extracted]), usage: { promptTokens: 1, completionTokens: 1 } });
    const service = new AiService(fakeRecorder());

    const result = await service.extractExamPage(
      { pageNumber: 4, pageText: 'Q1: What is the powerhouse of the cell?', grounding: [], answerKeyHints: 'A) Mitochondria' },
      ctx(),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].answerSource).toBe('provided');
    const call = runAiCall.mock.calls[0][0] as { userMessage: string; operation: string };
    expect(call.operation).toBe('extract-exam-page');
    expect(call.userMessage).toContain('Q1: What is the powerhouse of the cell?');
    expect(call.userMessage).toContain('A) Mitochondria');
  });

  it('classifySubject genuinely calls runAiCall with candidates/items folded into the user message', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify({ mappings: [{ ref: 'q1', subjectId: 5, confidence: 0.9 }] }), usage: { promptTokens: 1, completionTokens: 1 } });
    const service = new AiService(fakeRecorder());

    const result = await service.classifySubject(
      { candidates: [{ subjectId: 5, name: 'Biology' }], items: [{ ref: 'q1', questionText: 'What is a cell?' }] },
      ctx(),
    );
    expect(result.data.mappings[0].subjectId).toBe(5);
    const call = runAiCall.mock.calls[0][0] as { userMessage: string; operation: string };
    expect(call.operation).toBe('classify-subject');
    expect(call.userMessage).toContain('Biology');
    expect(call.userMessage).toContain('What is a cell?');
  });

  it('promptPractice folds subjectName and an empty grounding array into the system instruction/user message correctly', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify([VALID_QUESTION]), usage: { promptTokens: 1, completionTokens: 1 } });
    const service = new AiService(fakeRecorder());

    await service.promptPractice({ prompt: 'cell biology', count: 3, grounding: [], subjectName: 'Biology' }, ctx());
    const call = runAiCall.mock.calls[0][0] as { systemInstruction: string; userMessage: string };
    expect(call.systemInstruction).toContain('subject: Biology');
    expect(call.userMessage).toContain('No grounding context was retrieved');
  });

  it('captionImage threads the image bytes through to runAiCall (the one operation with image input)', async () => {
    process.env.AI_ENABLED = 'true';
    runAiCall.mockResolvedValue({ text: JSON.stringify({ caption: 'A diagram of a cell.', altText: 'Cell diagram' }), usage: { promptTokens: 1, completionTokens: 1 } });
    const service = new AiService(fakeRecorder());

    const result = await service.captionImage({ imageBase64: 'AAAA', mimeType: 'image/png' }, ctx());
    expect(result.data.caption).toBe('A diagram of a cell.');
    expect(runAiCall).toHaveBeenCalledWith(expect.objectContaining({ image: { base64: 'AAAA', mimeType: 'image/png' } }));
  });
});
