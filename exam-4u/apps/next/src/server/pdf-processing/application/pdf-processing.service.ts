import { randomUUID, createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { getEnv } from '@/server/config';
import { getRequestContext, requireTenantDataSource, requireTenantId, runWithRequestContext } from '@/server/context';
import { getAiService, getRetrievalService } from '@/server/ai';
import type { AiInvocationContext } from '@/server/ai';
import { AiDisabledError, AiServiceUnavailableError } from '@/server/ai';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { PermissionResolutionService, UserRoleRepository } from '@/server/rbac';
import { SubjectRepository } from '@/server/taxonomy';
import { getCurriculumIndexingService } from '@/server/curricula';
import { buildMediaServices } from '@/server/media';
import { getStoragePortSingleton } from '@/server/files';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { isPdfSignature } from '@/server/common/util/pdf-signature.util';
import type { PageText } from '@/server/common/util/chunking.util';
import { extractPdfPages } from '@/server/infrastructure/text-extraction';
import { DomainError, InternalDomainError } from '@/server/common/errors/domain-error';
import { getTenantsService } from '@/server/platform/tenants';
import { getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { logger } from '@/server/logging';
import type { PdfContentStrategy } from '../domain/content-type-strategy';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { PdfGenerationOrchestrator } from './pdf-generation-orchestrator.service';
import { SemanticDedupService } from './semantic-dedup.service';
import { ExamExtractionService } from './exam-extraction.service';
import { LessonGenerationService } from './lesson-generation.service';
import { ReferenceIndexingService } from './reference-indexing.service';
import { SubjectClassificationService } from './subject-classification.service';
import { ImageExtractionService } from './image-extraction.service';
import { PdfPostGenerationPassesService } from './post-generation-passes.service';
import {
  EmptyFileError,
  FileTooLargeError,
  InvalidExtensionError,
  InvalidFileSignatureError,
  NotSessionOwnerError,
  PdfProcessingSessionNotFoundError,
  UnrecognizedContentTypeError,
} from '../domain/errors';
import type { PdfContentType, PdfProcessingSessionSummary, UploadPdfInput, UploadPdfResult } from '../domain/pdf-processing.types';

/** LLD §7.3's "owner or `exams.review`" oversight-bypass permission — distinct from the route-level
 * `pdf.review` gate every caller must already hold to reach `getSession()` at all. */
const REVIEW_PERMISSION = 'exams.review';

/** The three raw, lowercase labels the AI engine is allowed to return, mapped to this table's
 * capitalized storage enum. Anything else is `UnrecognizedContentTypeError`, naming the exact raw
 * value the engine returned — never silently coerced to one of these three (FR-PDF-3). */
const RECOGNIZED_CONTENT_TYPES: Record<string, PdfContentType> = {
  lesson: 'Lesson',
  exam: 'Exam',
  reference: 'Reference',
};

/** A minimal, adapter-agnostic view of an uploaded multipart file — decouples this service from any
 * particular multipart-parsing library, matching `ExamAuthoringService`'s own established convention
 * for a Route Handler's `File` object. */
export interface UploadedFileLike {
  originalName: string;
  buffer: Buffer;
}

/**
 * FR-PDF-1/FR-PDF-2/FR-PDF-3's business logic (migration plan Phase 6, sub-slice "6a") — ported logic
 * (not code) from `legacy/api/src/modules/pdf-processing/application/pdf-processing.service.ts`'s
 * `PdfProcessingService`.
 *
 * **202-before-AI-work (this sub-slice's own exit gate, FR-PDF-1)**: {@link uploadPdf} does every piece
 * of synchronous, cheap work — validation, hashing, the storage write, and the session row insert —
 * then returns immediately. The dedup lookup, text extraction, and the classification call all run
 * *after* the response has already been built, inside {@link processSession}, scheduled via
 * `setImmediate` and never awaited by `uploadPdf` itself.
 *
 * **Fresh-tenant-scope re-entry for the background pipeline (this app's own adaptation of legacy's
 * `TenantScopeService.runFor`)**: `uploadPdf`'s `setImmediate` callback runs *after* the HTTP response
 * has been sent — by then `withTenantContext`'s own `finally` block may already have released the
 * request's pooled tenant `DataSource` and torn down its ALS binding. Rather than relying on either
 * surviving (an assumption legacy's own NestJS/Express request lifecycle never had to make), this
 * service re-acquires a FRESH tenant `DataSource` from the registry and rebinds a fresh ALS scope before
 * running `processSession` — mirroring `server/workers/outbox-publisher.ts`'s own established
 * `processTenant` pattern for "tenant-scoped code that isn't driven by a real `NextRequest`" exactly,
 * not a new pattern invented for this dispatch. See {@link buildPdfProcessingService}/
 * {@link runPdfProcessingInFreshTenantScope} below.
 *
 * **Dedup gate (FR-PDF-2, both tiers)**: {@link processSession} first checks
 * `PdfProcessingSessionRepository.findLatestCompletedByHash` *before* any text extraction or AI call
 * ({@link tryExactHashDedup}). An exact-hash hit short-circuits straight to `Completed` with
 * `reusedFromSessionId` set — `AiServicePort.classifyContent` is never called for a duplicate (this
 * sub-slice's own cost-control exit gate). Only on a tier-1 **miss** does {@link trySemanticDedup} run
 * `SemanticDedupService`'s cosine>=`FINGERPRINT_SIMILARITY_THRESHOLD` lookup against the tenant's
 * fingerprint collection. Both tiers apply the exact same reuse side effect ({@link applyReuse}) — a
 * semantic hit is indistinguishable, in every externally observable way, from an exact-hash hit.
 *
 * **Graceful AI-outage handling (FR-AI-1)**: an `AiDisabledError`/`AiServiceUnavailableError` thrown by
 * `classifyContent` (or propagated up from the generation branch) is caught in {@link processSession}
 * and leaves the session at whatever status it already reached — never `Failed` — so
 * `StaleSessionRecoveryWorker` can retry once the engine is back, per FR-REL-3's resumability
 * requirement.
 *
 * **Fingerprint write-back on completion**: once {@link processSession} sees the orchestrator return
 * with the session now `Completed`, it upserts this session's own fingerprint (best-effort, logged not
 * propagated on failure) so a *future* near-duplicate upload can be deduped against it — see
 * `PdfGenerationOrchestrator`'s own doc comment for why this sub-slice keeps that write-back here
 * rather than inside the orchestrator itself.
 */
export class PdfProcessingService {
  constructor(
    private readonly repository: PdfProcessingSessionRepository,
    private readonly storage: StoragePort,
    private readonly orchestrator: PdfGenerationOrchestrator,
    private readonly semanticDedup: SemanticDedupService,
    private readonly postGeneration: PdfPostGenerationPassesService,
  ) {}

  /**
   * FR-PDF-1: validates, hashes, stores, and creates a `Pending` session — then schedules the rest of
   * the pipeline to run afterward, never awaiting it.
   *
   * @throws {InvalidFileSignatureError} @throws {InvalidExtensionError} @throws {EmptyFileError}
   *   @throws {FileTooLargeError}
   */
  async uploadPdf(input: UploadPdfInput, file: UploadedFileLike): Promise<UploadPdfResult> {
    validateUploadedFile(file, getEnv().MAX_PDF_SIZE_BYTES);

    const tenantId = requireTenantIdOrInternal();
    const userId = requireUserIdOrInternal();
    const sessionId = randomUUID();
    const storageKeyPrefix = `tenants/${tenantId}/pdf/${sessionId}/`;
    const sourceStorageKey = `${storageKeyPrefix}source.pdf`;

    // Storage write happens synchronously, before the response — disk I/O, not AI work, and the
    // session row below needs a real key to point at.
    await this.storage.put(sourceStorageKey, file.buffer, 'application/pdf');

    const entity = new PdfProcessingSessionEntity();
    entity.id = sessionId;
    entity.initiatedByUserId = userId;
    entity.sourceFileName = file.originalName;
    entity.contentTypeHint = input.contentTypeHint ?? null;
    entity.contentType = null;
    entity.status = 'Pending';
    entity.storageKeyPrefix = storageKeyPrefix;
    entity.sourceStorageKey = sourceStorageKey;
    entity.subjectId = input.subjectId ?? null;
    entity.curriculumId = input.curriculumId ?? null;
    entity.curriculumDocumentId = null;
    entity.fileHash = sha256Hex(file.buffer);
    entity.forceReprocess = input.forceReprocess ?? false;
    entity.reusedFromSessionId = null;
    entity.pageCount = null;
    entity.tokensUsed = 0;
    entity.totalCost = 0;
    entity.budgetExhausted = false;
    entity.lastCompletedPage = 0;
    entity.coveredConcepts = null;
    entity.resumeAttempts = 0;
    entity.workerId = null;
    entity.heartbeatAt = null;
    entity.completedAt = null;

    await this.repository.insert(entity);

    // Fire-and-forget: intentionally not awaited (see class doc comment). Any failure inside the
    // scheduled work is caught by `processSession` itself and recorded on the session row — nothing
    // here can throw into the caller's already-built 202 response.
    scheduleProcessing(tenantId, sessionId, file.buffer);

    return { sessionId: entity.id, status: entity.status };
  }

  /**
   * `GET /api/pdf-processing/sessions` — the tenant-wide list backing the minimal status page's
   * "your uploads" view. Unlike `getSession`, this has no owner-or-reviewer narrowing (the Route
   * Handler itself already requires `pdf.review`, matching `GET /api/exam-types`'s identical
   * "the route's own permission gate is the only access check" shape) — every caller holding
   * `pdf.review` sees the full tenant-wide session list, not filtered to their own uploads. This
   * mirrors legacy's own precedent of never scoping a `pdf.review`-gated read to "just mine" (the
   * owner-only narrowing exists solely on `getSession`'s specific "did I upload this one" check).
   */
  async list(): Promise<PdfProcessingSessionSummary[]> {
    const sessions = await this.repository.findAll();
    return sessions.map(toSummary);
  }

  /** LLD §7.3: "owner or `exams.review`".
   * @throws {PdfProcessingSessionNotFoundError} @throws {NotSessionOwnerError} */
  async getSession(id: string): Promise<PdfProcessingSessionSummary> {
    const session = await this.requireSession(id);
    const userId = requireUserIdOrInternal();
    if (session.initiatedByUserId !== userId) {
      const permissions = new PermissionResolutionService(new UserRoleRepository(requireTenantDataSource()));
      if (!(await permissions.hasPermission(userId, REVIEW_PERMISSION))) {
        throw new NotSessionOwnerError();
      }
    }
    return toSummary(session);
  }

  /**
   * `StaleSessionRecoveryWorker`'s sole means of "resuming" a stuck session — re-reads the original PDF
   * from storage (the in-memory `buffer` from `uploadPdf` is long gone by the time a crash is
   * detected) and re-runs the same pipeline `processSession` runs, made safe to call more than once by
   * {@link tryExactHashDedup} (idempotent — a `Completed` session is never revisited), the already-
   * classified short-circuit in {@link classify}, and the generation branch's own `lastCompletedPage`
   * watermark. Caller is responsible for having already claimed the session
   * (`PdfProcessingSessionRepository.claimStale`) and for incrementing/checking `resumeAttempts` before
   * calling this — this method only knows how to re-run the pipeline, not the recovery policy.
   */
  async resumeProcessing(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    const { stream } = await this.storage.getStream(session.sourceStorageKey);
    const buffer = await streamToBuffer(stream);
    await this.processSession(sessionId, buffer);
  }

  /**
   * The dedup-gate -> extract -> classify -> generate pipeline (LLD §8.3), run entirely after the
   * client already received its 202 (or re-entered by `resumeProcessing`). Every reachable failure is
   * caught and recorded on the session row rather than thrown — there is no HTTP caller left to
   * propagate an exception to.
   */
  async processSession(sessionId: string, buffer: Buffer): Promise<void> {
    const session = await this.repository.findById(sessionId);
    if (!session) {
      // Unreachable in practice (this method is only ever invoked immediately after inserting the very
      // row it looks up, or via `resumeProcessing` against an already-claimed row) — defended
      // defensively rather than assumed.
      logger.error({ sessionId }, 'pdf_processing_session_not_found_in_process');
      return;
    }

    try {
      if (!session.forceReprocess && (await this.tryExactHashDedup(session))) {
        return; // FR-PDF-2 tier 1: AI pipeline skipped entirely for an exact-hash cache hit.
      }

      const { sampleText, pages } = await this.extract(session, buffer);

      // FR-PDF-2 tier 2 (only attempted after the tier-1 miss above): the fingerprint vector is
      // computed once and reused twice — for this lookup, and (on a miss, once the session goes on to
      // complete successfully) for the write-back below — so the document is never embedded twice for
      // the same purpose. `forceReprocess` bypasses this tier identically to tier 1. A failure here
      // (a transient embeddings/Qdrant outage) is caught and logged, not propagated.
      const fingerprintVector = await this.tryComputeFingerprint(sampleText);
      if (!session.forceReprocess && fingerprintVector && (await this.trySemanticDedup(session, fingerprintVector))) {
        return;
      }

      await this.classify(session, sampleText);

      session.status = 'Processing';
      await this.repository.save(session);

      await this.orchestrator.process(session, pages);

      // FR-PDF-7/FR-PDF-11's post-generation passes (sub-slice "6b"), run only once the generation
      // branch has written every `generated_question` row it will ever write — see
      // `PdfPostGenerationPassesService`'s own doc comment for why both live behind one collaborator
      // and why neither can ever fail an already-successful session.
      await this.postGeneration.run(session, requireTenantIdOrInternal(), buffer);

      // Only after the orchestrator has finished, and only for a session that reached `Completed` — a
      // reused-from-cache session short-circuits before this line entirely (see
      // `tryExactHashDedup`/`trySemanticDedup`, both `return` well above this point). `isCompleted` is a
      // separate function (not inlined) so TypeScript's control-flow analysis doesn't (incorrectly)
      // keep treating `session.status` as narrowed to the `'Processing'` literal this method itself
      // assigned a few lines above — `orchestrator.process` genuinely mutates it to `'Completed'`
      // in-place, a real cross-call mutation TS's narrowing can't see through a direct property
      // comparison at this call site.
      if (isCompleted(session) && fingerprintVector) {
        const tenantId = requireTenantIdOrInternal();
        await this.semanticDedup.upsertFingerprint(tenantId, session, fingerprintVector).catch((err: unknown) => {
          logger.error({ err, sessionId: session.id }, 'pdf_fingerprint_upsert_failed');
        });
      }
    } catch (err) {
      if (err instanceof AiDisabledError || err instanceof AiServiceUnavailableError) {
        // Graceful degradation (FR-AI-1): leave the session at whatever status it already reached
        // ('Classifying'/'Processing') — never 'Failed' — so `StaleSessionRecoveryWorker` can retry
        // once the engine is back. The error is recorded purely for operator visibility.
        session.errorCode = err.code;
        session.errorMessage = err.message;
        await this.repository.save(session).catch(() => undefined);
        return;
      }

      const domainError = err instanceof DomainError ? err : new InternalDomainError(err);
      // **Fix (found during Phase 8 closure's real-browser verification)**: `InternalDomainError`'s own
      // doc comment promises "the real `cause` is logged server-side only", but this site never
      // actually logged it before this fix — a session could durably reach `Failed`/`INTERNAL_ERROR`
      // with the client (correctly) seeing only the generic message, and the operator/log stream
      // seeing NOTHING beyond that same generic text, making the real failure completely
      // undiagnosable after the fact. Every other error-swallowing site in this same method (the
      // `AiDisabledError`/`AiServiceUnavailableError` branch above, and the `save` failure below) does
      // log the real underlying error immediately; this is that same discipline applied to the one
      // path that was missing it.
      logger.error({ err, sessionId, errorCode: domainError.code }, 'pdf_processing_session_failed');
      session.status = 'Failed';
      session.errorCode = domainError.code;
      session.errorMessage = domainError.message;
      await this.repository.save(session).catch((saveErr: unknown) => {
        logger.error({ err: saveErr, sessionId }, 'pdf_processing_failed_status_persist_failed');
      });
    }
  }

  /** FR-PDF-2 tier 1 — the cheapest possible check, run before any text extraction or AI call. Returns
   * `true` (session already updated to `Completed` via {@link applyReuse}) on a cache hit. */
  private async tryExactHashDedup(session: PdfProcessingSessionEntity): Promise<boolean> {
    const match = await this.repository.findLatestCompletedByHash(session.fileHash, session.id);
    if (!match) return false;
    await this.applyReuse(session, match);
    return true;
  }

  /** FR-PDF-2 tier 2 — only ever called after {@link tryExactHashDedup} has already missed. Delegates
   * the actual cosine-similarity lookup to `SemanticDedupService.findSemanticMatch`; applies the exact
   * same {@link applyReuse} side effect tier 1 uses. */
  private async trySemanticDedup(session: PdfProcessingSessionEntity, fingerprintVector: number[]): Promise<boolean> {
    const tenantId = requireTenantIdOrInternal();
    const match = await this.tryFindSemanticMatch(tenantId, fingerprintVector);
    if (!match) return false;
    await this.applyReuse(session, match);
    return true;
  }

  /** The one, shared "reuse an already-`Completed` session's result" side effect both dedup tiers
   * apply — a semantic-tier hit must be indistinguishable, in every externally observable way, from an
   * exact-hash hit. */
  private async applyReuse(session: PdfProcessingSessionEntity, match: PdfProcessingSessionEntity): Promise<void> {
    session.status = 'Completed';
    session.reusedFromSessionId = match.id;
    session.contentType = match.contentType;
    session.pageCount = match.pageCount;
    session.completedAt = new Date();
    await this.repository.save(session);
  }

  /** Best-effort wrapper around `SemanticDedupService.embedFingerprint` — a transient embeddings-
   * provider outage here degrades to "tier 2 skipped for this run" (logged), never `Failed`, since
   * tier 1 already provides the reliability-critical dedup guarantee this tier only augments. */
  private async tryComputeFingerprint(sampleText: string): Promise<number[] | null> {
    try {
      return await this.semanticDedup.embedFingerprint(sampleText);
    } catch (err) {
      logger.warn({ err }, 'pdf_semantic_dedup_embed_failed');
      return null;
    }
  }

  /** Best-effort wrapper around `SemanticDedupService.findSemanticMatch` — a transient Qdrant outage
   * degrades to "tier 2 skipped for this run" (logged), never `Failed`. */
  private async tryFindSemanticMatch(tenantId: string, fingerprintVector: number[]): Promise<PdfProcessingSessionEntity | null> {
    try {
      return await this.semanticDedup.findSemanticMatch(tenantId, fingerprintVector);
    } catch (err) {
      logger.warn({ err }, 'pdf_semantic_dedup_lookup_failed');
      return null;
    }
  }

  /** Extracts per-page text and returns both the full per-page text (consumed by the generation
   * branches) and the first 4000 characters — the exact sample size `ClassifyContentIn.sampleText`
   * specifies. Runs for every non-deduped session regardless of whether classification will actually be
   * called (a `contentTypeHint` still needs `pageCount` recorded). */
  private async extract(session: PdfProcessingSessionEntity, buffer: Buffer): Promise<{ sampleText: string; pages: PageText[] }> {
    session.status = 'Extracting';
    await this.repository.save(session);

    const pages = await extractPdfPages(buffer);
    session.pageCount = pages.length;
    await this.repository.save(session);

    const sampleText = pages
      .map((page) => page.text)
      .join('\n')
      .slice(0, 4000);
    return { sampleText, pages };
  }

  /**
   * FR-PDF-3: classifies the document, or bypasses classification entirely when the uploader supplied
   * a `contentTypeHint`.
   *
   * @throws {UnrecognizedContentTypeError} if the engine's raw label falls outside
   *   `{lesson,exam,reference}` — never silently coerced to one of the three known values.
   * @throws {AiDisabledError} @throws {AiServiceUnavailableError} propagated as-is for
   *   `processSession`'s graceful-degradation handling — never caught here.
   */
  private async classify(session: PdfProcessingSessionEntity, sampleText: string): Promise<void> {
    if (session.contentTypeHint) {
      session.contentType = session.contentTypeHint;
      return;
    }
    if (session.contentType) {
      // A resumed pass (`StaleSessionRecoveryWorker` re-invoking `processSession` via
      // `resumeProcessing`) may already have classified this document on a prior, crashed attempt — a
      // second AI classification call (real cost, real latency) is skipped rather than always re-run.
      return;
    }

    session.status = 'Classifying';
    await this.repository.save(session);

    // Budget is advisory-only at the port boundary. This sub-slice performs exactly one fixed
    // classification call, not the chunked, budget-bounded generation loop FR-PDF-12 governs — there is
    // nothing to bound here, so an effectively-unlimited budget is passed.
    const ctx: AiInvocationContext = {
      tenantId: requireTenantIdOrInternal(),
      userId: session.initiatedByUserId ?? undefined,
      processingSessionId: session.id,
      correlationId: randomUUID(),
      budget: { tokensRemaining: Number.MAX_SAFE_INTEGER, costRemainingUsd: Number.MAX_SAFE_INTEGER },
    };

    const result = await getAiService().classifyContent({ sampleText, fileName: session.sourceFileName }, ctx);

    const rawLabel = result.data.contentType;
    const normalized = rawLabel.trim().toLowerCase();
    const mapped = RECOGNIZED_CONTENT_TYPES[normalized];
    if (!mapped) {
      throw new UnrecognizedContentTypeError(rawLabel);
    }

    session.contentType = mapped;
    session.detectedTopics = result.data.topics;
    session.estimatedQuestionsPerPage = result.data.estimatedQuestionsPerPage;
    session.tokensUsed += result.usage.promptTokens + result.usage.completionTokens;
    session.totalCost = Number(session.totalCost) + (result.usage.costUsd ?? 0);
  }

  private async requireSession(id: string): Promise<PdfProcessingSessionEntity> {
    const session = await this.repository.findById(id);
    if (!session) throw new PdfProcessingSessionNotFoundError();
    return session;
  }
}

/** Per-file, in-memory-only validation (FR-PDF-1's upload-validation vocabulary) — cheapest/most-
 * certain check first (empty check needs nothing else; extension is a pure string check; the
 * magic-byte sniff is the most authoritative, so it runs last). */
function validateUploadedFile(file: UploadedFileLike, maxBytes: number): void {
  if (file.buffer.length === 0) throw new EmptyFileError();
  if (file.buffer.length > maxBytes) throw new FileTooLargeError(maxBytes);
  if (!/\.pdf$/i.test(file.originalName)) throw new InvalidExtensionError();
  if (!isPdfSignature(file.buffer)) throw new InvalidFileSignatureError();
}

function isCompleted(session: PdfProcessingSessionEntity): boolean {
  return session.status === 'Completed';
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Buffers a `StoragePort.getStream` result — `resumeProcessing`'s only use of it, since
 * `processSession`'s pipeline is written against a full in-memory `Buffer` (matching the original
 * `uploadPdf` call shape) rather than a stream. */
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function toSummary(entity: PdfProcessingSessionEntity): PdfProcessingSessionSummary {
  return {
    id: entity.id,
    sourceFileName: entity.sourceFileName,
    status: entity.status,
    contentTypeHint: entity.contentTypeHint,
    contentType: entity.contentType,
    errorCode: entity.errorCode,
    errorMessage: entity.errorMessage,
    detectedTopics: entity.detectedTopics,
    estimatedQuestionsPerPage: entity.estimatedQuestionsPerPage === null ? null : Number(entity.estimatedQuestionsPerPage),
    pageCount: entity.pageCount,
    tokensUsed: entity.tokensUsed,
    totalCost: Number(entity.totalCost),
    fileHash: entity.fileHash,
    reusedFromSessionId: entity.reusedFromSessionId,
    initiatedByUserId: entity.initiatedByUserId,
    totalQuestions: entity.totalQuestions,
    successfulQuestions: entity.successfulQuestions,
    createdAt: entity.createdAt,
    completedAt: entity.completedAt,
  };
}

/** Programmer-error guard, matching `ExamAuthoringService.requireTenantIdOrInternal`'s identical
 * framing — every call site of this function runs either inside a real `withTenantContext`-wrapped
 * request or inside {@link runPdfProcessingInFreshTenantScope}'s own rebinding, so a missing tenant id
 * here is a programmer error, not a client-facing condition. */
function requireTenantIdOrInternal(): string {
  try {
    return requireTenantId();
  } catch {
    throw new InternalDomainError(new Error('PdfProcessingService called outside any resolved tenant scope.'));
  }
}

/** Every route this service backs sits behind `requireTenantUser` (for the HTTP entry points) —
 * `processSession`'s own background work never calls this, since it derives `userId` from the
 * already-loaded session row instead. */
function requireUserIdOrInternal(): string {
  const userId = getRequestContext()?.userId;
  if (!userId) {
    throw new InternalDomainError(new Error('PdfProcessingService called outside any authenticated request.'));
  }
  return userId;
}

/**
 * Builds a fully-wired {@link PdfProcessingService} bound to an already-acquired tenant `DataSource` —
 * the one place both the request path (`server/pdf-processing/index.ts`'s `getPdfProcessingService`)
 * and the background-reschedule path ({@link runPdfProcessingInFreshTenantScope} below, in this SAME
 * file — see that function's own doc comment for why keeping both in one file avoids a real import
 * cycle) construct their collaborators, so the two paths can never silently drift apart on how a
 * `PdfProcessingService` is assembled.
 *
 * Every collaborator that itself needs the ambient tenant scope (`getAiService()`, used inside
 * `classify()`) is resolved lazily at call time inside the class itself, not here; the collaborators
 * built here (`ExamExtractionService`'s own `AiServicePort`/`RetrievalService`, `SemanticDedupService`'s
 * `QdrantVectorStoreAdapter`/`EmbeddingsPort`) are safe to construct eagerly since none of them read
 * `process.env`/ALS at CONSTRUCTION time — only `getAiService()` itself needs the ALS-bound tenant
 * `DataSource` (for its `AiCallLogRepository`), and this function is only ever called from inside an
 * already-established ALS scope (both call sites guarantee that), so calling it here at construction
 * time is safe.
 */
export function buildPdfProcessingService(dataSource: DataSource): PdfProcessingService {
  const sessions = new PdfProcessingSessionRepository(dataSource);
  const generatedQuestions = new GeneratedQuestionRepository(dataSource);
  const aiService = getAiService();
  const retrieval = getRetrievalService();

  // The generic `PdfContentStrategy[]` composition-root array sub-slice "6a" built the skeleton for.
  // Sub-slice "6b" appends the `Lesson` (FR-PDF-4) and `Reference` (FR-PDF-6) branches here — with no
  // change whatsoever to `PdfGenerationOrchestrator` itself, exactly as that skeleton was designed
  // for. All three recognized content types now have a real, wired branch; the orchestrator's
  // "no strategy registered -> complete with zero questions" fallback is consequently unreachable for
  // any classified session, and is kept only as the defensive default it always was.
  const examExtraction = new ExamExtractionService(aiService, sessions, retrieval);
  const lessonGeneration = new LessonGenerationService(aiService, sessions, retrieval);
  const referenceIndexing = new ReferenceIndexingService(getCurriculumIndexingService(dataSource));
  const strategies: PdfContentStrategy[] = [
    { contentType: 'Exam', run: (session, pages) => examExtraction.generate(session, pages) },
    { contentType: 'Lesson', run: (session, pages) => lessonGeneration.generate(session, pages) },
    { contentType: 'Reference', run: (session, pages) => referenceIndexing.index(session, pages) },
  ];
  const orchestrator = new PdfGenerationOrchestrator(strategies, generatedQuestions, sessions);

  const semanticDedup = new SemanticDedupService(getQdrantVectorStoreAdapter(), getEmbeddingsPort(), sessions);

  const media = buildMediaServices(dataSource);
  const postGeneration = new PdfPostGenerationPassesService(
    new SubjectClassificationService(aiService, new SubjectRepository(dataSource), generatedQuestions),
    new ImageExtractionService(media.imageAssociation, media.imageCaptioning, generatedQuestions),
  );

  return new PdfProcessingService(sessions, getStoragePortSingleton(), orchestrator, semanticDedup, postGeneration);
}

/** Schedules {@link runPdfProcessingInFreshTenantScope} to run after the current call stack unwinds —
 * see `PdfProcessingService`'s own class doc comment for why this re-acquires a fresh tenant
 * `DataSource`/ALS scope rather than relying on the original request's still being valid. */
function scheduleProcessing(tenantId: string, sessionId: string, buffer: Buffer): void {
  setImmediate(() => {
    runPdfProcessingInFreshTenantScope(tenantId, sessionId, buffer).catch((err: unknown) => {
      logger.error({ err, sessionId }, 'pdf_processing_session_background_run_failed');
    });
  });
}

/**
 * Re-acquires `tenantId`'s pooled `DataSource`, binds a fresh ALS scope matching what `withTenantContext`
 * would establish for a real request, runs one `processSession` pass via a FRESH
 * {@link buildPdfProcessingService} instance, then always releases the acquired `DataSource` — mirrors
 * `server/workers/outbox-publisher.ts`'s own `processTenant` helper exactly (this is not a new pattern
 * invented for this dispatch).
 *
 * **Deliberately defined in the same file as `PdfProcessingService`/`buildPdfProcessingService`, not
 * split into a separate composition-root file that imports the class**: `buildPdfProcessingService`
 * must call `new PdfProcessingService(...)`, and this function must call `buildPdfProcessingService` —
 * splitting them across two files that import each other would create a real ES-module import cycle at
 * the TOP level of both files (an actual correctness risk under bundling), whereas keeping every
 * cross-reference inside function BODIES in one file means nothing is ever read before its own module
 * has finished evaluating.
 */
async function runPdfProcessingInFreshTenantScope(tenantId: string, sessionId: string, buffer: Buffer): Promise<void> {
  const tenants = await getTenantsService();
  const tenant = await tenants.get(tenantId);
  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(tenant.schemaName);
  try {
    await runWithRequestContext(
      { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: tenant.subdomainSlug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
      async () => {
        const service = buildPdfProcessingService(dataSource);
        await service.processSession(sessionId, buffer);
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }
}
