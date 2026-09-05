import { z } from 'zod';

/**
 * Boundary zod schemas for each AI operation's `data` output shape (migration plan Phase 5) —
 * ported/trimmed from `legacy/api/src/infrastructure/ai/ai-service/ai-response.schemas.ts` (the
 * envelope/engine-error-code parts of that file are dropped — there is no longer an intermediate
 * engine wire protocol; only the six operations' own `data` shapes remain, hand-mirrored against
 * `@examland/contracts`'s `ai-service.dto.ts`).
 *
 * These are `zod@^3.23.8` schemas (this app's already-pinned major) — deliberately NOT passed to
 * `@google/adk`'s own `LlmAgent.outputSchema` (which depends on its own separate `zod@^4.2.1` copy);
 * see `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #6 for why a hand-built Google
 * `Schema` is used for the ADK-facing constraint instead, with these zod schemas re-validating the
 * model's JSON output on the way back — "validated again on the way back; never assume a constrained
 * response actually conformed."
 */

const zQuestionOption = z.object({ key: z.string(), text: z.string() });

const zGeneratedQuestionDraft = z.object({
  questionText: z.string(),
  options: z.array(zQuestionOption).min(4).max(5),
  correctAnswer: z.string(),
  explanation: z.string(),
  bloomsLevel: z.number().int().min(1).max(6),
  modelConfidence: z.number().min(0).max(1),
  concept: z.string(),
  sourcePageRange: z.string().optional(),
  sourceSection: z.string().optional(),
});

export const zClassifyContentOut = z.object({
  contentType: z.string(),
  topics: z.array(z.string()),
  estimatedQuestionsPerPage: z.number(),
});

export const zGeneratedQuestionDraftArray = z.array(zGeneratedQuestionDraft);

export const zExtractedQuestionDraftArray = z.array(
  zGeneratedQuestionDraft.extend({
    answerSource: z.enum(['provided', 'inferred']),
    groundingStrength: z.enum(['strong', 'weak', 'none']),
  }),
);

export const zSubjectMapOut = z.object({
  mappings: z.array(
    z.object({
      ref: z.string(),
      subjectId: z.number().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export const zImageCaptionOut = z.object({
  caption: z.string().min(1),
  altText: z.string().min(1).max(500),
});
