/**
 * TypeScript mirror of `services/ai-engine/src/ai_engine/contracts/*.py` (LLD §7.11). Hand-mirrored
 * by design, not code-generated — kept honest against the Python side by the shared JSON fixtures
 * in `services/ai-engine/tests/contract/fixtures/*.json`, asserted from both languages
 * (`ai-service.contract.spec.ts` on this side).
 *
 * This is the ONLY shape of the internal NestJS -> Python engine contract; `AiServicePort`
 * (`apps/api/src/ai/domain/ai-service.port.ts`) and `AiServiceClient`
 * (`apps/api/src/infrastructure/ai/ai-service/ai-service.client.ts`) both depend on these types,
 * never on ad-hoc inline shapes.
 */

/** The five AI operations this engine exposes (LLD §7.11). */
export type AiOperation =
  | 'classify-content'
  | 'generate-lesson-batch'
  | 'extract-exam-page'
  | 'classify-subject'
  | 'prompt-practice'
  | 'caption-image';

/** Every request's envelope metadata. `tenantId` is logging/attribution ONLY — the engine performs
 * no lookup with it (there is nothing in that process to look anything up in, HLD §6.1a). */
export interface AiRequestMeta {
  operation: AiOperation;
  tenantId: string;
  correlationId: string;
  processingSessionId?: string;
  userId?: string;
}

/** Resolved by `AiModelResolver` (LLD §9.12) — the ONLY source of a model id anywhere in the
 * system. The engine never resolves a model itself (a missing `primary` is `AI_MODEL_NOT_SUPPLIED`). */
export interface AiModelSelection {
  primary: string;
  fallback?: string;
}

/** Advisory only — the engine never enforces this itself; NestJS's own pre-batch budget check
 * (Dev-18a) is the actual enforcement point. */
export interface AiBudgetHint {
  tokensRemaining: number;
  costRemainingUsd: number;
}

export interface AiRequest<TInput> {
  meta: AiRequestMeta;
  model: AiModelSelection;
  budget?: AiBudgetHint;
  input: TInput;
}

export interface AiUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costUnavailable: boolean;
  latencyMs: number;
  attempts: number;
}

/** The engine's own internal error vocabulary (LLD §7.11) — INTERNAL ONLY, must never reach a
 * client response (see `error-codes.ts`'s `AI_SERVICE_UNAVAILABLE`/`AI_PROVIDER_FAILED` for the
 * public-facing codes these map to via `AiServiceClient`'s one error-mapping table). */
export type AiEngineErrorCode =
  | 'AI_UNAUTHORIZED'
  | 'AI_BAD_REQUEST'
  | 'AI_MODEL_NOT_SUPPLIED'
  | 'AI_OUTPUT_INVALID'
  | 'AI_UPSTREAM_FAILED'
  | 'AI_UPSTREAM_RATE_LIMITED'
  | 'AI_UPSTREAM_TIMEOUT'
  | 'AI_ENGINE_NOT_CONFIGURED';

export type AiResponse<TData> =
  | { ok: true; usage: AiUsage; data: TData; droppedItems: number; warnings?: string[] }
  | { ok: false; usage?: AiUsage; error: { code: AiEngineErrorCode; message: string; details?: object } };

/** Passed IN; the engine never retrieves (HLD §6.1a — `retrieve_context` is a caller-side NestJS
 * step, not an engine tool). */
export interface GroundingChunk {
  text: string;
  fileName: string;
  pageNumber: number;
  score: number;
}

// ── 1. classify-content (FR-PDF-3) ──────────────────────────────────────────
export interface ClassifyContentIn {
  sampleText: string;
  fileName: string;
}
export interface ClassifyContentOut {
  /** Raw label, NOT coerced — NestJS raises `UNRECOGNIZED_CONTENT_TYPE` naming this exact value
   * when it falls outside {lesson,exam,reference}. */
  contentType: string;
  topics: string[];
  estimatedQuestionsPerPage: number;
}

// ── 2. generate-lesson-batch (FR-PDF-4, FR-PDF-13) ──────────────────────────
export interface LessonBatchIn {
  excerpt: string;
  sourceSection?: string;
  pageRange?: string;
  /** <= 10, enforced both sides. */
  targetQuestionCount: number;
  /** Rolling, cap 80, supplied by the orchestrator. */
  coveredConcepts: string[];
  /** topK 5. */
  grounding: GroundingChunk[];
  reviewRounds?: 0 | 1 | 2;
  language?: string;
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface GeneratedQuestionDraft {
  questionText: string;
  /** 4-5 options. */
  options: QuestionOption[];
  /** Must be one of `options[].key`. */
  correctAnswer: string;
  explanation: string;
  bloomsLevel: number;
  /** RAW model confidence, 0-1 — `calibrateConfidence()` (LLD §9.3) owns the stored value. */
  modelConfidence: number;
  concept: string;
  sourcePageRange?: string;
  sourceSection?: string;
}

// ── 3. extract-exam-page (FR-PDF-5) ─────────────────────────────────────────
export interface ExtractPageIn {
  pageNumber: number;
  /** Caller guarantees >= 20 chars — pages below that are skipped before ever calling the engine. */
  pageText: string;
  /** topK 12, resolved once per document. */
  grounding: GroundingChunk[];
  answerKeyHints?: string;
}

export interface ExtractedQuestionDraft extends GeneratedQuestionDraft {
  answerSource: 'provided' | 'inferred';
  groundingStrength: 'strong' | 'weak' | 'none';
}

// ── 4. classify-subject (FR-PDF-7 / FR-AUTH-6) ──────────────────────────────
export interface SubjectCandidate {
  subjectId: number;
  name: string;
}
export interface SubjectMapItem {
  ref: string;
  questionText: string;
}
export interface SubjectMapIn {
  candidates: SubjectCandidate[];
  items: SubjectMapItem[];
}
export interface SubjectMapping {
  ref: string;
  /** null = "cannot determine" -> caller leaves it unmapped. NEVER a guessed fallback subject. */
  subjectId: number | null;
  confidence: number;
}
export interface SubjectMapOut {
  mappings: SubjectMapping[];
}

// ── 5. prompt-practice (FR-CUR-5) ───────────────────────────────────────────
export interface PromptPracticeIn {
  prompt: string;
  /** 1-30, validated in NestJS first. */
  count: number;
  /** topK 12; empty array is a valid retrieval state, not an error. */
  grounding: GroundingChunk[];
  subjectName?: string;
}

// ── 6. caption-image (BL-35/FR-PDF-11 vision captioning, Dev-36 — new operation) ───────────
/** The one operation (of six) whose input carries image bytes, not just text — see
 * `services/ai-engine/src/ai_engine/agents/image_caption.py`'s module doc comment for why none of
 * the original five could be reused. */
export interface ImageCaptionIn {
  /** Base64-encoded raw image bytes — the engine never fetches an image itself. */
  imageBase64: string;
  /** e.g. `image/png`, `image/jpeg`. */
  mimeType: string;
  /** Optional surrounding page text, if the caller has it (not populated by this phase's own
   * `ImageExtractionService` call site — see that service's own doc comment). */
  pageContext?: string;
}
export interface ImageCaptionOut {
  /** Content-rich description — this is the text embedded into retrieval (BL-35's whole point). */
  caption: string;
  /** Short WCAG screen-reader alt text — replaces `ImageExtractionService`'s page-number
   * placeholder when captioning succeeds. */
  altText: string;
}
