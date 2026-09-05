import { InternalController } from './internal.controller';

function makeReq(bodyBuffer: Buffer | string) {
  return { body: bodyBuffer } as never;
}

describe('InternalController (cluster-only surface, :8081)', () => {
  function make(opts: { verifiedEvent?: unknown; session?: unknown }) {
    // `verifyWebhook` is async on the real port (QA Phase 3 D-1) — mocking it
    // with `mockResolvedValue` keeps this spec's double aligned with the real
    // adapter's signature so a future missing-`await` regression here would
    // still surface as a type error, not just a silently-passing mock.
    const liveKit = { verifyWebhook: jest.fn().mockResolvedValue(opts.verifiedEvent ?? null) };
    const sessions = { findByRoomName: jest.fn().mockResolvedValue(opts.session ?? null) };
    const applyEvent = { execute: jest.fn().mockResolvedValue(undefined) };
    const controller = new InternalController(liveKit as never, sessions as never, applyEvent as never);
    return { controller, liveKit, sessions, applyEvent };
  }

  it('drops the webhook silently when the signature does not verify', async () => {
    const { controller, applyEvent } = make({ verifiedEvent: null });
    await controller.webhook(makeReq(Buffer.from('{}')), 'bad-sig');
    expect(applyEvent.execute).not.toHaveBeenCalled();
  });

  it('drops the webhook when the event has no room name', async () => {
    const { controller, applyEvent } = make({ verifiedEvent: { event: 'participant_joined' } });
    await controller.webhook(makeReq(Buffer.from('{}')), 'sig');
    expect(applyEvent.execute).not.toHaveBeenCalled();
  });

  it('drops the webhook when no session matches the room name', async () => {
    const { controller, sessions, applyEvent } = make({
      verifiedEvent: { event: 'participant_joined', room: { name: 'acme_s1' } },
      session: null,
    });
    await controller.webhook(makeReq(Buffer.from('{}')), 'sig');
    expect(sessions.findByRoomName).toHaveBeenCalledWith('acme_s1');
    expect(applyEvent.execute).not.toHaveBeenCalled();
  });

  it('applies the active event on participant_joined (FR-TRANSPORT-4 pending->active)', async () => {
    const session = { id: 's1', roomName: 'acme_s1', status: 'pending' };
    const { controller, applyEvent } = make({
      verifiedEvent: { event: 'participant_joined', room: { name: 'acme_s1' } },
      session,
    });
    await controller.webhook(makeReq(Buffer.from('{}')), 'sig');
    expect(applyEvent.execute).toHaveBeenCalledWith(session, 'active');
  });

  it('applies the ended event on room_finished (authoritative end per LLD §8.3)', async () => {
    const session = { id: 's1', roomName: 'acme_s1', status: 'active' };
    const { controller, applyEvent } = make({
      verifiedEvent: { event: 'room_finished', room: { name: 'acme_s1' } },
      session,
    });
    await controller.webhook(makeReq(Buffer.from('{}')), 'sig');
    expect(applyEvent.execute).toHaveBeenCalledWith(session, 'ended');
  });

  it('ignores an unrecognized event type', async () => {
    const session = { id: 's1', roomName: 'acme_s1', status: 'active' };
    const { controller, applyEvent } = make({
      verifiedEvent: { event: 'egress_started', room: { name: 'acme_s1' } },
      session,
    });
    await controller.webhook(makeReq(Buffer.from('{}')), 'sig');
    expect(applyEvent.execute).not.toHaveBeenCalled();
  });

  it('handles a non-Buffer body defensively', async () => {
    const { controller, liveKit } = make({ verifiedEvent: null });
    await controller.webhook(makeReq('{}' as never), undefined);
    expect(liveKit.verifyWebhook).toHaveBeenCalledWith('{}', '');
  });
});
