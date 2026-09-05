import { Type, type Schema } from '@google/genai';

/**
 * Hand-built Gemini-style `Schema` objects (migration plan Phase 5) constraining each AI operation's
 * JSON output — passed as `adk/ai-runner.ts`'s `outputSchema`, which `openrouter-llm.ts` converts to
 * OpenRouter's `response_format: {type: 'json_schema'}`. Structurally mirrors
 * `../domain/ai-response.schemas.ts`'s zod schemas (the two are kept honest against each other by
 * both being hand-derived from the same `@examland/contracts` `ai-service.dto.ts` shapes) — the zod
 * schemas are what actually gates a response as valid (re-validated after parsing); these `Schema`
 * objects are only a generation-time hint to the model, per this project's "never assume a
 * constrained response actually conformed" rule.
 */

const questionOptionSchema: Schema = {
  type: Type.OBJECT,
  properties: { key: { type: Type.STRING }, text: { type: Type.STRING } },
  required: ['key', 'text'],
};

const generatedQuestionDraftSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    questionText: { type: Type.STRING },
    options: { type: Type.ARRAY, items: questionOptionSchema, minItems: '4', maxItems: '5' },
    correctAnswer: { type: Type.STRING },
    explanation: { type: Type.STRING },
    bloomsLevel: { type: Type.INTEGER, minimum: 1, maximum: 6 },
    modelConfidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
    concept: { type: Type.STRING },
    sourcePageRange: { type: Type.STRING },
    sourceSection: { type: Type.STRING },
  },
  required: ['questionText', 'options', 'correctAnswer', 'explanation', 'bloomsLevel', 'modelConfidence', 'concept'],
};

const extractedQuestionDraftSchema: Schema = {
  ...generatedQuestionDraftSchema,
  properties: {
    ...generatedQuestionDraftSchema.properties,
    answerSource: { type: Type.STRING, enum: ['provided', 'inferred'] },
    groundingStrength: { type: Type.STRING, enum: ['strong', 'weak', 'none'] },
  },
  required: [...(generatedQuestionDraftSchema.required ?? []), 'answerSource', 'groundingStrength'],
};

export const classifyContentOutSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    contentType: { type: Type.STRING },
    topics: { type: Type.ARRAY, items: { type: Type.STRING } },
    estimatedQuestionsPerPage: { type: Type.NUMBER },
  },
  required: ['contentType', 'topics', 'estimatedQuestionsPerPage'],
};

export const generatedQuestionDraftArraySchema: Schema = { type: Type.ARRAY, items: generatedQuestionDraftSchema };

export const extractedQuestionDraftArraySchema: Schema = { type: Type.ARRAY, items: extractedQuestionDraftSchema };

export const subjectMapOutSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    mappings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ref: { type: Type.STRING },
          subjectId: { type: Type.INTEGER, nullable: true },
          confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
        },
        required: ['ref', 'subjectId', 'confidence'],
      },
    },
  },
  required: ['mappings'],
};

export const imageCaptionOutSchema: Schema = {
  type: Type.OBJECT,
  properties: { caption: { type: Type.STRING }, altText: { type: Type.STRING, maxLength: '500' } },
  required: ['caption', 'altText'],
};
