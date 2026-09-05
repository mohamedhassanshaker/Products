import { PrismaFeedbackRepository } from './prisma-feedback.repository';

describe('PrismaFeedbackRepository', () => {
  function makePrisma() {
    return {
      db: { feedback: { create: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) } },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('creates a Feedback row', async () => {
    const prisma = makePrisma();
    const repo = new PrismaFeedbackRepository(prisma as never);
    const result = await repo.create({ sessionId: 's1', tenantId: 't1', rating: 5, comment: 'Great!' });
    expect(result).toBe('created');
    expect(prisma.db.feedback.create).toHaveBeenCalledWith({
      data: { sessionId: 's1', tenantId: 't1', rating: 5, comment: 'Great!' },
    });
  });

  it('returns duplicate when the unique session_id constraint rejects the write', async () => {
    const prisma = makePrisma();
    prisma.db.feedback.create.mockRejectedValue(new Error('Unique constraint failed'));
    const repo = new PrismaFeedbackRepository(prisma as never);
    const result = await repo.create({ sessionId: 's1', tenantId: 't1', rating: 3, comment: null });
    expect(result).toBe('duplicate');
  });

  it('existsForSession is false when no row exists', async () => {
    const prisma = makePrisma();
    const repo = new PrismaFeedbackRepository(prisma as never);
    expect(await repo.existsForSession('s1')).toBe(false);
  });

  it('existsForSession is true when a row exists', async () => {
    const prisma = makePrisma();
    prisma.db.feedback.findUnique.mockResolvedValue({ id: 'f1' });
    const repo = new PrismaFeedbackRepository(prisma as never);
    expect(await repo.existsForSession('s1')).toBe(true);
  });
});
