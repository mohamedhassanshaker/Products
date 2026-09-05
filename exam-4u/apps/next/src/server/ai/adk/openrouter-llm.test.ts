import { Type, type Schema } from '@google/genai';
import type { LlmRequest } from '@google/adk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterHttpError, OpenRouterLlm } from './openrouter-llm';

/** Unit coverage for `OpenRouterLlm.generateContentAsync` — the actual OpenRouter HTTP call —
 * using a stubbed global `fetch` (no real network). Complements, not replaces,
 * `scripts/ai-smoke.ts`'s real end-to-end proof against the live OpenRouter endpoint. */

function baseRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }], toolsDict: {}, liveConnectConfig: {}, ...overrides } as LlmRequest;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OpenRouterLlm.generateContentAsync', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.AI_SERVICE_TIMEOUT_MS = '90000';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.AI_SERVICE_TIMEOUT_MS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  it('matches OpenRouter provider/model[:variant]-shaped ids, never a bare Gemini-style id', () => {
    const [regex] = OpenRouterLlm.supportedModels;
    expect(regex.test('anthropic/claude-3.5-haiku')).toBe(true);
    expect(regex.test('openai/gpt-4o-mini')).toBe(true);
    expect(regex.test('qwen/qwen3.8-27b:free')).toBe(true);
    expect(regex.test('gemini-1.5-flash')).toBe(false);
  });

  it('POSTs to {OPENROUTER_BASE_URL}/chat/completions with the model id, an Authorization bearer header, and the user message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'hi there' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });

    const results = [];
    for await (const chunk of llm.generateContentAsync(baseRequest())) results.push(chunk);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('anthropic/claude-3.5-haiku');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);

    expect(results).toHaveLength(1);
    expect(results[0].content?.parts?.[0].text).toBe('hi there');
    expect(results[0].finishReason).toBe('STOP');
    expect(results[0].usageMetadata?.promptTokenCount).toBe(5);
    expect(results[0].usageMetadata?.candidatesTokenCount).toBe(2);
  });

  it('prepends a system message built from config.systemInstruction', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    const request = baseRequest({ config: { systemInstruction: 'You are a helpful assistant.' } });

    for await (const _chunk of llm.generateContentAsync(request)) void _chunk;

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
  });

  it('maps the ADK "model" role to OpenAI\'s "assistant" role', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    const request = baseRequest({ contents: [{ role: 'model', parts: [{ text: 'previous reply' }] }, { role: 'user', parts: [{ text: 'follow up' }] }] });

    for await (const _chunk of llm.generateContentAsync(request)) void _chunk;

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([{ role: 'assistant', content: 'previous reply' }, { role: 'user', content: 'follow up' }]);
  });

  it('builds a multi-modal image_url content block when a Part carries inlineData (captionImage)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"caption":"x","altText":"y"}' } }] }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    const request = baseRequest({ contents: [{ role: 'user', parts: [{ text: 'describe' }, { inlineData: { data: 'AAAA', mimeType: 'image/png' } }] }] });

    for await (const _chunk of llm.generateContentAsync(request)) void _chunk;

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('converts a Gemini Schema responseSchema into an OpenAI json_schema response_format', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    const schema: Schema = { type: Type.OBJECT, properties: { x: { type: Type.STRING } }, required: ['x'] };
    const request = baseRequest({ config: { responseSchema: schema, responseMimeType: 'application/json' } });

    for await (const _chunk of llm.generateContentAsync(request)) void _chunk;

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'output', strict: false, schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } } });
  });

  it('falls back to bare json_object mode when responseMimeType is json but no schema was supplied', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    const request = baseRequest({ config: { responseMimeType: 'application/json' } });

    for await (const _chunk of llm.generateContentAsync(request)) void _chunk;

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format entirely for plain free-text generation', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'free text' } }] }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });

    for await (const _chunk of llm.generateContentAsync(baseRequest())) void _chunk;

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('throws OpenRouterHttpError carrying the real status/body on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'No cookie auth credentials found', code: 401 } }), { status: 401 }));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });

    let caught: OpenRouterHttpError | undefined;
    try {
      for await (const _chunk of llm.generateContentAsync(baseRequest())) void _chunk;
    } catch (err) {
      caught = err as OpenRouterHttpError;
    }
    expect(caught).toBeInstanceOf(OpenRouterHttpError);
    expect(caught?.status).toBe(401);
    expect(caught?.body).toContain('No cookie auth credentials found');
  });

  it('rejects a streaming request (unsupported, never exercised by this app)', async () => {
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    await expect(async () => {
      for await (const _chunk of llm.generateContentAsync(baseRequest(), true)) void _chunk;
    }).rejects.toThrow(/does not support streaming/);
  });

  it('connect() (live/bidi) always throws — nothing in this app opens a live connection', async () => {
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    await expect(llm.connect()).rejects.toThrow(/does not support live\/bidi connections/);
  });

  it('propagates a fetch-level network failure (e.g. connection refused) as-is', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));
    const llm = new OpenRouterLlm({ model: 'anthropic/claude-3.5-haiku' });
    await expect(async () => {
      for await (const _chunk of llm.generateContentAsync(baseRequest())) void _chunk;
    }).rejects.toThrow('fetch failed: ECONNREFUSED');
  });
});
