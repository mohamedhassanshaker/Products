import { SessionLogsController } from './session-logs.controller';

describe('SessionLogsController', () => {
  function make() {
    const listSessions = { execute: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const getSession = { execute: jest.fn().mockResolvedValue({ id: 's1' }) };
    const getTranscript = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const getHops = { execute: jest.fn().mockResolvedValue({ cycles: [] }) };
    const controller = new SessionLogsController(listSessions as never, getSession as never, getTranscript as never, getHops as never);
    return { controller, listSessions, getSession, getTranscript, getHops };
  }

  const actor = { id: 'a1', email: 'a@x.com', roles: ['operator'], tenantIds: [] };

  it('list delegates to ListSessionsUseCase', async () => {
    const { controller, listSessions } = make();
    await controller.list(actor as never, { q: 'hi' } as never);
    expect(listSessions.execute).toHaveBeenCalledWith(actor, { q: 'hi' });
  });

  it('detail delegates to GetSessionUseCase', async () => {
    const { controller, getSession } = make();
    const result = await controller.detail(actor as never, 's1');
    expect(getSession.execute).toHaveBeenCalledWith(actor, 's1');
    expect(result).toEqual({ id: 's1' });
  });

  it('transcript delegates to GetTranscriptUseCase', async () => {
    const { controller, getTranscript } = make();
    await controller.transcript(actor as never, 's1');
    expect(getTranscript.execute).toHaveBeenCalledWith(actor, 's1');
  });

  it('hops delegates to GetHopsUseCase', async () => {
    const { controller, getHops } = make();
    await controller.hops(actor as never, 's1');
    expect(getHops.execute).toHaveBeenCalledWith(actor, 's1');
  });
});
