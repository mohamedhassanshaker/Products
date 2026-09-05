import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@/server/context';
import { AiDisabledError, AiServiceUnavailableError, type AiServicePort } from '@/server/ai';
import type { SubjectRepository } from '@/server/taxonomy';
import { SubjectClassificationService } from './subject-classification.service';
import type { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';

function question(id: string) {
  return { id, questionText: `Question ${id}`, subjectId: null };
}

function usage() {
  return { model: 'm', promptTokens: 10, completionTokens: 5, costUsd: 0.01, costUnavailable: false, latencyMs: 1, attempts: 1 };
}

function makeService(opts: {
  unmapped?: ReturnType<typeof question>[];
  subjects?: { id: number; name: string }[];
  classifySubject?: ReturnType<typeof vi.fn>;
}) {
  const classifySubject = opts.classifySubject ?? vi.fn().mockResolvedValue({ data: { mappings: [] }, usage: usage(), droppedItems: 0 });
  const subjects = { findAll: vi.fn().mockResolvedValue(opts.subjects ?? [{ id: 1, name: 'Biology' }]) };
  const generatedQuestions = {
    findUnmappedForSession: vi.fn().mockResolvedValue(opts.unmapped ?? []),
    findUnmappedForExamType: vi.fn().mockResolvedValue(opts.unmapped ?? []),
    updateSubject: vi.fn().mockResolvedValue(undefined),
  };
  const service = new SubjectClassificationService(
    { classifySubject } as unknown as AiServicePort,
    subjects as unknown as SubjectRepository,
    generatedQuestions as unknown as GeneratedQuestionRepository,
  );
  return { service, classifySubject, subjects, generatedQuestions };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: 'tenant-1' }, fn);
}

describe('SubjectClassificationService (FR-PDF-7 / FR-AUTH-6)', () => {
  it('is a genuine no-op with zero AI calls when nothing is unmapped (idempotent second run)', async () => {
    const { service, classifySubject, subjects } = makeService({ unmapped: [] });
    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 0, mapped: 0 });
    expect(classifySubject).not.toHaveBeenCalled();
    expect(subjects.findAll).not.toHaveBeenCalled();
  });

  it('makes no AI call when the tenant has no subjects to map against — leaves rows unmapped, not an error', async () => {
    const { service, classifySubject } = makeService({ unmapped: [question('q1')], subjects: [] });
    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 1, mapped: 0 });
    expect(classifySubject).not.toHaveBeenCalled();
  });

  it('writes back every determined mapping and reports examined/mapped honestly', async () => {
    const classifySubject = vi.fn().mockResolvedValue({
      data: { mappings: [{ ref: 'q1', subjectId: 1, confidence: 0.9 }, { ref: 'q2', subjectId: 2, confidence: 0.8 }] },
      usage: usage(),
      droppedItems: 0,
    });
    const { service, generatedQuestions } = makeService({ unmapped: [question('q1'), question('q2')], classifySubject });

    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 2, mapped: 2 });
    expect(generatedQuestions.updateSubject).toHaveBeenCalledWith('q1', 1);
    expect(generatedQuestions.updateSubject).toHaveBeenCalledWith('q2', 2);
  });

  it('leaves a "cannot determine" (subjectId null) mapping unmapped — NEVER a guessed fallback', async () => {
    const classifySubject = vi.fn().mockResolvedValue({
      data: { mappings: [{ ref: 'q1', subjectId: null, confidence: 0.1 }] },
      usage: usage(),
      droppedItems: 0,
    });
    const { service, generatedQuestions } = makeService({ unmapped: [question('q1')], classifySubject });

    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 1, mapped: 0 });
    expect(generatedQuestions.updateSubject).not.toHaveBeenCalled();
  });

  it('discards a mapping naming a ref outside the batch it asked about (hallucinated/stale id defense)', async () => {
    const classifySubject = vi.fn().mockResolvedValue({
      data: { mappings: [{ ref: 'not-in-batch', subjectId: 1, confidence: 0.9 }] },
      usage: usage(),
      droppedItems: 0,
    });
    const { service, generatedQuestions } = makeService({ unmapped: [question('q1')], classifySubject });

    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 1, mapped: 0 });
    expect(generatedQuestions.updateSubject).not.toHaveBeenCalled();
  });

  it('only ever looks at rows the repository already filtered to subject_id IS NULL (never re-classifies a mapped row)', async () => {
    const { service, generatedQuestions } = makeService({ unmapped: [question('q1')] });
    await withTenant(() => service.classifyUnmappedForSession('sess-1'));
    expect(generatedQuestions.findUnmappedForSession).toHaveBeenCalledWith('sess-1');
    expect(generatedQuestions.findUnmappedForExamType).not.toHaveBeenCalled();
  });

  it('swallows an AI-disabled outage — questions simply remain unmapped for a later retroactive re-run', async () => {
    const classifySubject = vi.fn().mockRejectedValue(new AiDisabledError());
    const { service } = makeService({ unmapped: [question('q1')], classifySubject });
    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 1, mapped: 0 });
  });

  it('swallows an engine-unavailable outage identically', async () => {
    const classifySubject = vi.fn().mockRejectedValue(new AiServiceUnavailableError('down'));
    const { service } = makeService({ unmapped: [question('q1')], classifySubject });
    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).resolves.toEqual({ examined: 1, mapped: 0 });
  });

  it('does NOT swallow an unexpected (non-AI) error — a real bug still surfaces', async () => {
    const classifySubject = vi.fn().mockRejectedValue(new Error('boom'));
    const { service } = makeService({ unmapped: [question('q1')], classifySubject });
    await expect(withTenant(() => service.classifyUnmappedForExamType('et-1'))).rejects.toThrow('boom');
  });

  it('classifyUnmappedForSession returns the mapped count and forwards the acting user for audit context', async () => {
    const classifySubject = vi.fn().mockResolvedValue({
      data: { mappings: [{ ref: 'q1', subjectId: 1, confidence: 0.9 }] },
      usage: usage(),
      droppedItems: 0,
    });
    const { service } = makeService({ unmapped: [question('q1')], classifySubject });

    await expect(withTenant(() => service.classifyUnmappedForSession('sess-1', 'user-1'))).resolves.toBe(1);
    expect(classifySubject.mock.calls[0][1]).toMatchObject({ tenantId: 'tenant-1', userId: 'user-1', processingSessionId: 'sess-1' });
  });
});
