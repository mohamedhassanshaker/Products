import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';

// `classify()` calls `getAiService()` (a plain module-level composition-root function) directly
// rather than taking it as a constructor collaborator (see `PdfProcessingService`'s own class doc
// comment for why) — mocked here so this suite controls its return value/rejections without a real
// tenant DataSource/ADK call path. `AiDisabledError`/`AiServiceUnavailableError` stay the REAL classes
// (imported via `importActual`) since `processSession`'s own `instanceof` branching depends on them.
const classifyContent = vi.fn();
vi.mock('@/server/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ai')>();
  return { ...actual, getAiService: () => ({ classifyContent, available: true }) };
});

// `extract()` calls `extractPdfPages` from this barrel directly.
const extractPdfPages = vi.fn();
vi.mock('@/server/infrastructure/text-extraction', () => ({ extractPdfPages: (...args: unknown[]) => extractPdfPages(...(args as [])) }));

// `getSession`'s owner-or-reviewer oversight check constructs a real `PermissionResolutionService`
// bound to a `UserRoleRepository` — both mocked here since this suite is about
// `PdfProcessingService`'s own dedup/classify/status logic, not RBAC resolution itself (that has its
// own dedicated suite).
const hasPermission = vi.fn();
vi.mock('@/server/rbac', () => ({
  PermissionResolutionService: class {
    hasPermission = hasPermission;
  },
  UserRoleRepository: class {},
}));

const { PdfProcessingService } = await import('./pdf-processing.service');
const { AiDisabledError, AiServiceUnavailableError } = await import('@/server/ai');

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

function buildPdf(pageTexts: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const text of pageTexts) {
      doc.addPage();
      if (text.length > 0) doc.text(text);
    }
    doc.end();
  });
}

function withTenant<T>(fn: () => Promise<T>, userId: string | undefined = USER_ID): Promise<T> {
  // `tenantDataSource` is a dummy, never-dereferenced placeholder — `PermissionResolutionService` is
  // fully mocked in this suite (see the `vi.mock('@/server/rbac', ...)` above), so
  // `requireTenantDataSource()`'s only real consumer here never actually uses it as a real `DataSource`.
  return runWithRequestContext({ requestId: randomUUID(), tenantId: TENANT_ID, userId, tenantDataSource: {} as never }, fn);
}

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-1',
    initiatedByUserId: USER_ID,
    sourceFileName: 'doc.pdf',
    contentTypeHint: null,
    contentType: null,
    status: 'Pending',
    errorMessage: null,
    errorCode: null,
    totalQuestions: 0,
    successfulQuestions: 0,
    detectedTopics: null,
    estimatedQuestionsPerPage: null,
    storageKeyPrefix: `tenants/${TENANT_ID}/pdf/sess-1/`,
    sourceStorageKey: `tenants/${TENANT_ID}/pdf/sess-1/source.pdf`,
    subjectId: null,
    curriculumId: null,
    curriculumDocumentId: null,
    fileHash: 'hash-1',
    forceReprocess: false,
    reusedFromSessionId: null,
    pageCount: null,
    tokensUsed: 0,
    totalCost: 0,
    budgetExhausted: false,
    lastCompletedPage: 0,
    coveredConcepts: null,
    resumeAttempts: 0,
    workerId: null,
    heartbeatAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });
}

/** Builds a service with fully-fake collaborators (repository/storage/orchestrator/semanticDedup) —
 * this suite exercises `PdfProcessingService`'s own dedup-gate/state-machine/graceful-degradation
 * logic, never real I/O. */
function makeService(overrides?: {
  repository?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
  storage?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
  orchestrator?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
  semanticDedup?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
  postGeneration?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
}) {
  const savedSessions: PdfProcessingSessionEntity[] = [];
  const repository = {
    insert: vi.fn().mockImplementation(async (e: PdfProcessingSessionEntity) => e),
    findById: vi.fn().mockResolvedValue(fakeSession()),
    findLatestCompletedByHash: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation(async (e: PdfProcessingSessionEntity) => {
      savedSessions.push(Object.assign(new PdfProcessingSessionEntity(), e));
      return e;
    }),
    findAll: vi.fn().mockResolvedValue([]),
    ...overrides?.repository,
  };
  const storage = {
    put: vi.fn().mockResolvedValue({ key: 'k', size: 1 }),
    getStream: vi.fn(),
    ...overrides?.storage,
  };
  const orchestrator = {
    process: vi.fn().mockImplementation(async (s: PdfProcessingSessionEntity) => {
      s.status = 'Completed';
      s.completedAt = new Date();
    }),
    ...overrides?.orchestrator,
  };
  const semanticDedup = {
    embedFingerprint: vi.fn().mockResolvedValue(null),
    findSemanticMatch: vi.fn().mockResolvedValue(null),
    upsertFingerprint: vi.fn().mockResolvedValue(undefined),
    ...overrides?.semanticDedup,
  };

  // Phase 6 sub-slice "6b": FR-PDF-7 subject classification + FR-PDF-11 image extraction run behind
  // one `PdfPostGenerationPassesService` collaborator once generation finishes.
  const postGeneration = { run: vi.fn().mockResolvedValue(undefined), ...overrides?.postGeneration };

  const service = new PdfProcessingService(
    repository as never,
    storage as never,
    orchestrator as never,
    semanticDedup as never,
    postGeneration as never,
  );
  return { service, repository, storage, orchestrator, semanticDedup, postGeneration, savedSessions };
}

beforeEach(() => {
  classifyContent.mockReset();
  extractPdfPages.mockReset();
  hasPermission.mockReset();
});

describe('PdfProcessingService.uploadPdf — upload validation (FR-PDF-1)', () => {
  it('INVALID_FILE_SIGNATURE: a file without the %PDF- magic bytes is rejected', async () => {
    const { service } = makeService();
    const file = { originalName: 'a.pdf', buffer: Buffer.from('not a real pdf') };
    await expect(withTenant(() => service.uploadPdf({}, file))).rejects.toThrow('is not a genuine PDF');
  });

  it('INVALID_EXTENSION: a non-.pdf filename is rejected regardless of its content', async () => {
    const { service } = makeService();
    const pdf = await buildPdf(['hello']);
    const file = { originalName: 'a.txt', buffer: pdf };
    await expect(withTenant(() => service.uploadPdf({}, file))).rejects.toThrow('Only .pdf files are accepted');
  });

  it('EMPTY_FILE: a zero-byte upload is rejected', async () => {
    const { service } = makeService();
    await expect(withTenant(() => service.uploadPdf({}, { originalName: 'a.pdf', buffer: Buffer.alloc(0) }))).rejects.toThrow('is empty');
  });

  it('202-before-AI-work: uploadPdf resolves (the 202 response) without ever awaiting the background pipeline', async () => {
    const { service, repository } = makeService();
    const pdf = await buildPdf(['some content']);
    const file = { originalName: 'a.pdf', buffer: pdf };

    const result = await withTenant(() => service.uploadPdf({}, file));

    expect(result.status).toBe('Pending');
    expect(repository.insert).toHaveBeenCalledTimes(1);
    // extractPdfPages/classifyContent are only ever invoked from the scheduled background work
    // (setImmediate), never synchronously inside uploadPdf itself.
    expect(extractPdfPages).not.toHaveBeenCalled();
    expect(classifyContent).not.toHaveBeenCalled();
  });
});

describe('PdfProcessingService.processSession — dedup gate (FR-PDF-2)', () => {
  it('tier 1 (exact-hash) hit: reuses the match, marks Completed, and never extracts or classifies', async () => {
    const match = fakeSession({ id: 'sess-original', status: 'Completed', contentType: 'Exam', pageCount: 3 });
    const { service, savedSessions } = makeService({ repository: { findLatestCompletedByHash: vi.fn().mockResolvedValue(match) } });

    await service.processSession('sess-1', Buffer.from('irrelevant'));

    expect(extractPdfPages).not.toHaveBeenCalled();
    expect(classifyContent).not.toHaveBeenCalled();
    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).toBe('Completed');
    expect(finalRow.reusedFromSessionId).toBe('sess-original');
    expect(finalRow.contentType).toBe('Exam');
  });

  it('tier 1 miss + tier 2 (semantic) hit: reuses the match identically to a tier-1 hit, and classifyContent is never called', async () => {
    const match = fakeSession({ id: 'sess-semantic', status: 'Completed', contentType: 'Reference', pageCount: 7 });
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'near-duplicate content' }]);
    const { service, savedSessions, semanticDedup } = makeService({
      repository: { findLatestCompletedByHash: vi.fn().mockResolvedValue(null) },
      semanticDedup: { embedFingerprint: vi.fn().mockResolvedValue([0.1, 0.2]), findSemanticMatch: vi.fn().mockResolvedValue(match) },
    });

    await withTenant(() => service.processSession('sess-1', Buffer.from('irrelevant')));

    expect(classifyContent).not.toHaveBeenCalled();
    expect(semanticDedup.findSemanticMatch).toHaveBeenCalled();
    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).toBe('Completed');
    expect(finalRow.reusedFromSessionId).toBe('sess-semantic');
  });

  it('forceReprocess bypasses BOTH dedup tiers even when a completed match exists', async () => {
    const match = fakeSession({ id: 'sess-original', status: 'Completed' });
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'exam', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, savedSessions } = makeService({
      repository: { findById: vi.fn().mockResolvedValue(fakeSession({ forceReprocess: true })), findLatestCompletedByHash: vi.fn().mockResolvedValue(match) },
    });

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    // Never reused — went all the way through extract/classify/generate.
    expect(savedSessions.some((s) => s.reusedFromSessionId !== null)).toBe(false);
    expect(classifyContent).toHaveBeenCalledTimes(1);
  });

  it('a transient embeddings-provider failure degrades tier 2 to "skipped for this run" (logged), never Failed', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'exam', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, savedSessions } = makeService({
      repository: { findLatestCompletedByHash: vi.fn().mockResolvedValue(null) },
      semanticDedup: { embedFingerprint: vi.fn().mockRejectedValue(new Error('embeddings provider unreachable')) },
    });

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).not.toBe('Failed');
  });
});

describe('PdfProcessingService.processSession — classification (FR-PDF-3)', () => {
  it('a contentTypeHint bypasses classification entirely', async () => {
    const { service, savedSessions } = makeService({ repository: { findById: vi.fn().mockResolvedValue(fakeSession({ contentTypeHint: 'Exam' })) } });
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    expect(classifyContent).not.toHaveBeenCalled();
    expect(savedSessions.at(-1)!.contentType).toBe('Exam');
  });

  it('UNRECOGNIZED_CONTENT_TYPE: an out-of-vocabulary raw label fails the session with the exact raw label named, never coerced', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'worksheet', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, savedSessions } = makeService();

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).toBe('Failed');
    expect(finalRow.errorCode).toBe('UNRECOGNIZED_CONTENT_TYPE');
    expect(finalRow.errorMessage).toContain('worksheet');
  });

  it('classifyContent is never called twice on a resumed pass that already classified the document', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    const { service } = makeService({ repository: { findById: vi.fn().mockResolvedValue(fakeSession({ contentType: 'Exam' })) } });

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    expect(classifyContent).not.toHaveBeenCalled();
  });
});

describe('PdfProcessingService.processSession — graceful AI-outage degradation (FR-AI-1)', () => {
  it('AiServiceUnavailableError during classify leaves the session at Classifying, never Failed', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    classifyContent.mockRejectedValue(new AiServiceUnavailableError());
    const { service, savedSessions } = makeService();

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).toBe('Classifying');
    expect(finalRow.status).not.toBe('Failed');
    expect(finalRow.errorCode).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('AiDisabledError during classify leaves the session at Classifying, never Failed', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    classifyContent.mockRejectedValue(new AiDisabledError());
    const { service, savedSessions } = makeService();

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).toBe('Classifying');
    expect(finalRow.errorCode).toBe('AI_DISABLED');
  });

  it('an outage thrown by the generation orchestrator (after classification already succeeded) is handled identically — never Failed', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'content' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'exam', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, savedSessions } = makeService({ orchestrator: { process: vi.fn().mockRejectedValue(new AiServiceUnavailableError()) } });

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    const finalRow = savedSessions.at(-1)!;
    expect(finalRow.status).toBe('Processing'); // whatever it already reached — never Failed
  });
});

describe('PdfProcessingService.processSession — generation dispatch and fingerprint write-back', () => {
  it('dispatches the classified session and its extracted pages to the orchestrator', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'exam content' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'exam', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, orchestrator } = makeService();

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    expect(orchestrator.process).toHaveBeenCalledTimes(1);
  });

  it('upserts the fingerprint once the session reaches Completed, using the vector already computed for the tier-2 lookup', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: 'exam content' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'exam', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, semanticDedup } = makeService({ semanticDedup: { embedFingerprint: vi.fn().mockResolvedValue([0.4, 0.5]) } });

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    expect(semanticDedup.upsertFingerprint).toHaveBeenCalledTimes(1);
  });

  it('never upserts a fingerprint when there was no extractable text to embed', async () => {
    extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: '' }]);
    classifyContent.mockResolvedValue({ data: { contentType: 'exam', topics: [], estimatedQuestionsPerPage: 1 }, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } });
    const { service, semanticDedup } = makeService({ semanticDedup: { embedFingerprint: vi.fn().mockResolvedValue(null) } });

    await withTenant(() => service.processSession('sess-1', Buffer.from('x')));

    expect(semanticDedup.upsertFingerprint).not.toHaveBeenCalled();
  });
});

describe('PdfProcessingService.getSession — ownership (LLD §7.3 "owner or exams.review")', () => {
  it('the owner can read their own session without needing exams.review', async () => {
    const { service } = makeService({ repository: { findById: vi.fn().mockResolvedValue(fakeSession({ initiatedByUserId: USER_ID })) } });
    const result = await withTenant(() => service.getSession('sess-1'), USER_ID);
    expect(result.id).toBe('sess-1');
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('a non-owner without exams.review is rejected with NotSessionOwnerError', async () => {
    hasPermission.mockResolvedValue(false);
    const { service } = makeService({ repository: { findById: vi.fn().mockResolvedValue(fakeSession({ initiatedByUserId: USER_ID })) } });
    await expect(withTenant(() => service.getSession('sess-1'), OTHER_USER_ID)).rejects.toThrow('do not have access');
  });

  it('a non-owner WITH exams.review can read the session (the oversight bypass)', async () => {
    hasPermission.mockResolvedValue(true);
    const { service } = makeService({ repository: { findById: vi.fn().mockResolvedValue(fakeSession({ initiatedByUserId: USER_ID })) } });
    const result = await withTenant(() => service.getSession('sess-1'), OTHER_USER_ID);
    expect(result.id).toBe('sess-1');
  });

  it('SESSION_NOT_FOUND for an unknown id', async () => {
    const { service } = makeService({ repository: { findById: vi.fn().mockResolvedValue(null) } });
    await expect(withTenant(() => service.getSession('missing'))).rejects.toThrow('No such PDF processing session');
  });
});
