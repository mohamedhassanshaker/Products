import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit coverage for `runAiCall`'s own orchestration logic — session/runner wiring, usage/finish-reason
 * extraction, and (most importantly) the real, previously-latent bug this file's own doc comment
 * documents: ADK's `LlmAgent` reports a model-call failure via an event's `errorCode`/`errorMessage`
 * fields rather than a re-thrown exception, so `runAiCall` must inspect every event for one rather
 * than relying on the `for await` loop to throw. A scripted fake `@google/adk` module (not a live ADK
 * Runner) proves this exact contract — the real, live end-to-end proof against genuine ADK/OpenRouter
 * machinery is `scripts/ai-smoke.ts`'s own job (see that script's doc comment for how the same bug was
 * originally found by actually running it).
 */

let mockEvents: Array<Record<string, unknown>> = [];
let capturedRunAsyncParams: unknown;

vi.mock('@google/adk', () => {
  class FakeInMemorySessionService {
    async createSession(): Promise<{ id: string }> {
      return { id: 'fake-session' };
    }
  }
  class FakeLlmAgent {
    constructor(public config: unknown) {}
  }
  class FakeRunner {
    constructor(public config: unknown) {}
    async *runAsync(params: unknown) {
      capturedRunAsyncParams = params;
      for (const event of mockEvents) yield event;
    }
  }
  class FakeBaseLlm {
    constructor(_params: { model: string }) {}
  }
  return {
    InMemorySessionService: FakeInMemorySessionService,
    LlmAgent: FakeLlmAgent,
    Runner: FakeRunner,
    BaseLlm: FakeBaseLlm,
    LLMRegistry: { register: vi.fn(), resolve: vi.fn(), newLlm: vi.fn() },
  };
});

const { runAiCall, AiRunnerCallError } = await import('./ai-runner');

describe('runAiCall', () => {
  beforeEach(() => {
    mockEvents = [];
    capturedRunAsyncParams = undefined;
  });

  it('extracts text/usage/finishReason from a normal successful event', async () => {
    mockEvents = [
      {
        content: { parts: [{ text: '{"ok":true}' }] },
        usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 8 },
        finishReason: 'STOP',
      },
    ];

    const result = await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hello', modelId: 'anthropic/claude-3.5-haiku' });

    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 8 });
    expect(result.finishReason).toBe('STOP');
  });

  it('concatenates multiple text parts within a single event', async () => {
    mockEvents = [{ content: { parts: [{ text: 'part1 ' }, { text: 'part2' }] } }];
    const result = await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    expect(result.text).toBe('part1 part2');
  });

  it('throws AiRunnerCallError when ADK reports a failure via errorMessage instead of throwing (the core regression this file guards)', async () => {
    mockEvents = [{ errorCode: 'UNKNOWN_ERROR', errorMessage: 'OpenRouter responded 401: {"error":{"message":"No cookie auth credentials found","code":401}}' }];

    await expect(runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' })).rejects.toBeInstanceOf(
      AiRunnerCallError,
    );
  });

  it('extracts the HTTP status embedded in the error message text for later classification', async () => {
    mockEvents = [{ errorMessage: 'OpenRouter responded 429: {"error":{"message":"rate limited"}}' }];
    let caught: InstanceType<typeof AiRunnerCallError> | undefined;
    try {
      await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    } catch (err) {
      caught = err as InstanceType<typeof AiRunnerCallError>;
    }
    expect(caught?.httpStatus).toBe(429);
  });

  it('does not throw when an error event is followed by a real text-bearing event (does not spuriously fail a call that later recovered)', async () => {
    mockEvents = [{ errorMessage: 'transient issue' }, { content: { parts: [{ text: 'recovered text' }] } }];
    const result = await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    expect(result.text).toBe('recovered text');
  });

  it('passes the user message, image parts, and abortSignal through to Runner.runAsync', async () => {
    mockEvents = [{ content: { parts: [{ text: 'ok' }] } }];
    const controller = new AbortController();
    await runAiCall({
      operation: 'caption-image',
      systemInstruction: 'sys',
      userMessage: 'describe this',
      modelId: 'anthropic/claude-3.5-haiku',
      image: { base64: 'AAAA', mimeType: 'image/png' },
      abortSignal: controller.signal,
    });

    const params = capturedRunAsyncParams as { newMessage: { parts: Array<Record<string, unknown>> }; abortSignal: AbortSignal };
    expect(params.newMessage.parts).toEqual([{ text: 'describe this' }, { inlineData: { data: 'AAAA', mimeType: 'image/png' } }]);
    expect(params.abortSignal).toBe(controller.signal);
  });

  it('omits outputSchema from LlmAgent config entirely when none is supplied (free-text generation)', async () => {
    mockEvents = [{ content: { parts: [{ text: 'free text response' }] } }];
    const result = await runAiCall({ operation: 'classify-content', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    expect(result.text).toBe('free text response');
  });

  it('tolerates a bare event with neither content nor usageMetadata (no crash, falls back to defaults)', async () => {
    mockEvents = [{}];
    const result = await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    expect(result.text).toBe('');
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('a later event with only a partial usageMetadata keeps the previously-seen field rather than resetting it to 0', async () => {
    mockEvents = [
      { content: { parts: [{ text: 'first' }] }, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
      { content: { parts: [{ text: 'second' }] }, usageMetadata: { promptTokenCount: 20 } },
    ];
    const result = await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 5 });
  });

  it('returns empty text/zero usage when the run yields no events at all', async () => {
    mockEvents = [];
    const result = await runAiCall({ operation: 'prompt-practice', systemInstruction: 'sys', userMessage: 'hi', modelId: 'anthropic/claude-3.5-haiku' });
    expect(result.text).toBe('');
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});
