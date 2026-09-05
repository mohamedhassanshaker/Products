import { describe, expect, it, vi } from 'vitest';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { PdfPostGenerationPassesService } from './post-generation-passes.service';
import type { ImageExtractionService } from './image-extraction.service';
import type { SubjectClassificationService } from './subject-classification.service';

function session() {
  return Object.assign(new PdfProcessingSessionEntity(), { id: 'sess-1', initiatedByUserId: 'user-1' });
}

function make(overrides: { classify?: ReturnType<typeof vi.fn>; extract?: ReturnType<typeof vi.fn> } = {}) {
  const classifyUnmappedForSession = overrides.classify ?? vi.fn().mockResolvedValue(3);
  const extractAndAssociate = overrides.extract ?? vi.fn().mockResolvedValue(undefined);
  const service = new PdfPostGenerationPassesService(
    { classifyUnmappedForSession } as unknown as SubjectClassificationService,
    { extractAndAssociate } as unknown as ImageExtractionService,
  );
  return { service, classifyUnmappedForSession, extractAndAssociate };
}

describe('PdfPostGenerationPassesService (FR-PDF-7 + FR-PDF-11 post-generation passes)', () => {
  it('runs subject classification then image extraction, forwarding tenant/user/buffer', async () => {
    const { service, classifyUnmappedForSession, extractAndAssociate } = make();
    const s = session();
    const buffer = Buffer.from('pdf');

    await service.run(s, 't-1', buffer);

    expect(classifyUnmappedForSession).toHaveBeenCalledWith('sess-1', 'user-1');
    expect(extractAndAssociate).toHaveBeenCalledWith(s, 't-1', buffer);
    expect(classifyUnmappedForSession.mock.invocationCallOrder[0]).toBeLessThan(extractAndAssociate.mock.invocationCallOrder[0]);
  });

  it('still runs the image pass when subject classification throws unexpectedly (one pass never blocks the other)', async () => {
    const { service, extractAndAssociate } = make({ classify: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(service.run(session(), 't-1', Buffer.from('pdf'))).resolves.toBeUndefined();
    expect(extractAndAssociate).toHaveBeenCalled();
  });

  it('never propagates an image-pass failure — a fully-generated session is never retroactively failed', async () => {
    const { service } = make({ extract: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(service.run(session(), 't-1', Buffer.from('pdf'))).resolves.toBeUndefined();
  });

  it('tolerates a session with no recorded uploader (passes undefined rather than null)', async () => {
    const { service, classifyUnmappedForSession } = make();
    const s = Object.assign(session(), { initiatedByUserId: null });
    await service.run(s, 't-1', Buffer.from('pdf'));
    expect(classifyUnmappedForSession).toHaveBeenCalledWith('sess-1', undefined);
  });
});
