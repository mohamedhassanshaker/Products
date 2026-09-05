import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

const USER_ID = 'u-1';

function makeService(overrides: {
  permittedPermissions?: string[];
  curricula?: unknown[];
  examTypes?: unknown[];
  history?: unknown[];
  practiceSessions?: unknown[];
} = {}) {
  const permittedPermissions = new Set(
    overrides.permittedPermissions ?? ['curricula.manage_own', 'exams.read', 'attempts.read_own'],
  );
  const permissions = {
    hasPermission: vi.fn(async (_userId: string, permission: string) => permittedPermissions.has(permission)),
  };
  const curricula = { list: vi.fn().mockResolvedValue(overrides.curricula ?? [{ id: 'c-1' }, { id: 'c-2' }]) };
  const examAuthoring = { list: vi.fn().mockResolvedValue(overrides.examTypes ?? [{ id: 'et-1' }]) };
  const attempts = { listOwnHistory: vi.fn().mockResolvedValue(overrides.history ?? []) };
  const practiceSessions = { findRecentByUser: vi.fn().mockResolvedValue(overrides.practiceSessions ?? []) };

  const service = new DashboardService(
    permissions as never,
    curricula as never,
    examAuthoring as never,
    attempts as never,
    practiceSessions as never,
  );
  return { service, permissions, curricula, examAuthoring, attempts, practiceSessions };
}

describe('DashboardService.getSummary (migration plan Phase 9 sub-slice "9c")', () => {
  it('includes every section when the acting user holds every gating permission', async () => {
    const { service, curricula, examAuthoring, attempts, practiceSessions } = makeService({
      practiceSessions: [{ id: 'ps-1', kind: 'LessonSubject', status: 'Completed', requestedCount: 5, createdAt: new Date('2026-01-01') }],
    });

    const summary = await service.getSummary(USER_ID);

    expect(summary.curricula).toEqual({ count: 2 });
    expect(summary.examTypes).toEqual({ count: 1 });
    expect(summary.attempts).toEqual({ recent: [], inProgress: null });
    expect(summary.practice?.recent).toHaveLength(1);
    expect(summary.practice?.recent[0]).toMatchObject({ id: 'ps-1', kind: 'LessonSubject' });
    expect(curricula.list).toHaveBeenCalledWith(USER_ID);
    expect(examAuthoring.list).toHaveBeenCalledWith();
    expect(attempts.listOwnHistory).toHaveBeenCalledWith();
    expect(practiceSessions.findRecentByUser).toHaveBeenCalledWith(USER_ID, 3);
  });

  it('omits a section entirely when the acting user lacks its gating permission (never a 403, never a fabricated 0)', async () => {
    const { service, curricula, examAuthoring } = makeService({ permittedPermissions: ['attempts.read_own'] });

    const summary = await service.getSummary(USER_ID);

    expect(summary.curricula).toBeUndefined();
    expect(summary.examTypes).toBeUndefined();
    expect(summary.practice).toBeUndefined();
    expect(summary.attempts).toBeDefined();
    expect(curricula.list).not.toHaveBeenCalled();
    expect(examAuthoring.list).not.toHaveBeenCalled();
  });

  it('separates the in-progress attempt (continue card) from the recent-completed list, and caps recent at 5', async () => {
    const history = [
      { attemptId: 'a-in-progress', status: 'InProgress' },
      ...Array.from({ length: 7 }, (_, i) => ({ attemptId: `a-${i}`, status: 'Submitted' })),
    ];
    const { service } = makeService({ history });

    const summary = await service.getSummary(USER_ID);

    expect(summary.attempts?.inProgress).toMatchObject({ attemptId: 'a-in-progress' });
    expect(summary.attempts?.recent).toHaveLength(5);
    expect(summary.attempts?.recent.every((a: { status: string }) => a.status !== 'InProgress')).toBe(true);
  });

  it('reports no in-progress attempt as null, not omitted, when every attempt is already closed', async () => {
    const { service } = makeService({ history: [{ attemptId: 'a-1', status: 'Submitted' }] });
    const summary = await service.getSummary(USER_ID);
    expect(summary.attempts?.inProgress).toBeNull();
  });

  it('caps recent practice sessions at 3, delegating the actual query to PracticeSessionRepository.findRecentByUser', async () => {
    const { service, practiceSessions } = makeService();
    await service.getSummary(USER_ID);
    expect(practiceSessions.findRecentByUser).toHaveBeenCalledWith(USER_ID, 3);
  });
});
