import { describe, expect, it } from 'vitest';
import { AiServiceDisabledAdapter } from './ai-service-disabled.adapter';
import { AiDisabledError } from './errors';

/** Ported behavior from `legacy/api/src/infrastructure/ai/ai-service/ai-service.disabled.ts`'s own
 * (untested-in-legacy, but trivial) contract — every operation fails closed with `AiDisabledError`,
 * `getReadiness()` reports `{state:'disabled'}`, and `available` is always `false`. */
describe('AiServiceDisabledAdapter', () => {
  it('available is always false and getReadiness reports {state: "disabled"}', () => {
    const adapter = new AiServiceDisabledAdapter();
    expect(adapter.available).toBe(false);
    expect(adapter.getReadiness()).toEqual({ state: 'disabled' });
  });

  const ctx = { tenantId: 't1', correlationId: 'c1', budget: { tokensRemaining: 0, costRemainingUsd: 0 } };

  it('every operation throws AiDisabledError, never resolving', async () => {
    const adapter = new AiServiceDisabledAdapter();
    await expect(adapter.classifyContent({ sampleText: 'x', fileName: 'f' }, ctx)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(adapter.generateLessonBatch({ excerpt: 'x', targetQuestionCount: 1, coveredConcepts: [], grounding: [] }, ctx)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(adapter.extractExamPage({ pageNumber: 1, pageText: 'x', grounding: [] }, ctx)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(adapter.classifySubject({ candidates: [], items: [] }, ctx)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(adapter.promptPractice({ prompt: 'x', count: 1, grounding: [] }, ctx)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(adapter.captionImage({ imageBase64: 'AAAA', mimeType: 'image/png' }, ctx)).rejects.toBeInstanceOf(AiDisabledError);
  });
});
