import type {
  AiReadinessState,
  ClassifyContentIn,
  ExtractPageIn,
  ImageCaptionIn,
  LessonBatchIn,
  PromptPracticeIn,
  SubjectMapIn,
} from '@examland/contracts';
import type { AiInvocationContext, AiServicePort } from './ai-service.port';
import { AiDisabledError } from './errors';

/**
 * `AI_ENABLED=false` binding — ported from
 * `legacy/api/src/infrastructure/ai/ai-service/ai-service.disabled.ts`'s `AiServiceDisabledAdapter`.
 * Every operation fails closed with `AiDisabledError` WITHOUT constructing an `AiCircuitBreaker` or
 * ever touching `adk/ai-runner.ts` — selected instead of {@link import('../application/ai.service').AiService}
 * by `server/ai/index.ts`'s `getAiService()` composition root when `AI_ENABLED=false`, mirroring
 * legacy's own documented rationale exactly: "the breaker machinery in [the real implementation] is
 * never even instantiated in that configuration, which is a stronger guarantee than a runtime `if`
 * inside a single class."
 */
export class AiServiceDisabledAdapter implements AiServicePort {
  readonly available = false;

  getReadiness(): AiReadinessState {
    return { state: 'disabled' };
  }

  async classifyContent(...args: [ClassifyContentIn, AiInvocationContext]) {
    return this.fail(args);
  }
  async generateLessonBatch(...args: [LessonBatchIn, AiInvocationContext]) {
    return this.fail(args);
  }
  async extractExamPage(...args: [ExtractPageIn, AiInvocationContext]) {
    return this.fail(args);
  }
  async classifySubject(...args: [SubjectMapIn, AiInvocationContext]) {
    return this.fail(args);
  }
  async promptPractice(...args: [PromptPracticeIn, AiInvocationContext]) {
    return this.fail(args);
  }
  async captionImage(...args: [ImageCaptionIn, AiInvocationContext]) {
    return this.fail(args);
  }

  private fail(args: unknown[]): never {
    void args;
    throw new AiDisabledError();
  }
}
