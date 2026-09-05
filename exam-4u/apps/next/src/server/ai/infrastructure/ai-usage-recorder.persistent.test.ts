import { describe, expect, it, vi } from 'vitest';
import { AiCallLogEntity } from '@/server/infrastructure/database';
import type { AiCallLogRepository } from './ai-call-log.repository';
import { PersistentAiUsageRecorder } from './ai-usage-recorder.persistent';

function fakeRepo(overrides: Partial<AiCallLogRepository> = {}): AiCallLogRepository {
  return { insert: vi.fn(async () => undefined), ...overrides } as unknown as AiCallLogRepository;
}

const usage = { model: 'anthropic/claude-3.5-haiku', promptTokens: 10, completionTokens: 5, costUsd: null, costUnavailable: true, latencyMs: 200, attempts: 1 };

describe('PersistentAiUsageRecorder.record', () => {
  it('maps a successful AiUsageRecord to an ai_call_log row with outcome=Success and error=null', () => {
    const repo = fakeRepo();
    const recorder = new PersistentAiUsageRecorder(repo);

    recorder.record({ tenantId: 't1', operation: 'prompt-practice', correlationId: 'c1', usage, ok: true, droppedItems: 0 });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'prompt-practice',
        model: 'anthropic/claude-3.5-haiku',
        promptTokens: 10,
        completionTokens: 5,
        outcome: 'Success',
        error: null,
        correlationId: 'c1',
      } satisfies Partial<AiCallLogEntity>),
    );
  });

  it('maps a failed/dropped AiUsageRecord to outcome=Failed with an error string naming droppedItems', () => {
    const repo = fakeRepo();
    const recorder = new PersistentAiUsageRecorder(repo);

    recorder.record({ tenantId: 't1', operation: 'prompt-practice', correlationId: 'c1', usage, ok: false, droppedItems: 1 });

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'Failed', error: 'droppedItems=1' }));
  });

  it('generates a fresh UUID id for every row and carries processingSessionId through when present', () => {
    const repo = fakeRepo();
    const recorder = new PersistentAiUsageRecorder(repo);

    recorder.record({ tenantId: 't1', operation: 'extract-exam-page', correlationId: 'c1', processingSessionId: 'sess-1', usage, ok: true, droppedItems: 0 });

    const inserted = (repo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as AiCallLogEntity;
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.processingSessionId).toBe('sess-1');
  });

  it('is fire-and-forget/fail-safe: a rejected insert() never throws out of record() (never breaks the AI call site that triggered it)', () => {
    const repo = fakeRepo({ insert: vi.fn(async () => { throw new Error('DB write failed'); }) });
    const recorder = new PersistentAiUsageRecorder(repo);

    expect(() => recorder.record({ tenantId: 't1', operation: 'prompt-practice', correlationId: 'c1', usage, ok: true, droppedItems: 0 })).not.toThrow();
  });
});
