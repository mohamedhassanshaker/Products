const listRooms = jest.fn();
const createRoom = jest.fn();
const deleteRoom = jest.fn();
const createDispatch = jest.fn();
const verify = jest.fn();
const receive = jest.fn();
const toJwt = jest.fn();
const addGrant = jest.fn();

jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn().mockImplementation(() => ({ listRooms, createRoom, deleteRoom })),
  AgentDispatchClient: jest.fn().mockImplementation(() => ({ createDispatch })),
  TokenVerifier: jest.fn().mockImplementation(() => ({ verify })),
  WebhookReceiver: jest.fn().mockImplementation(() => ({ receive })),
  AccessToken: jest.fn().mockImplementation(() => ({ addGrant, toJwt })),
}));

import { LiveKitClientAdapter } from './livekit-client.adapter';

describe('LiveKitClientAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'devsecretdevsecretdevsecret';
  });

  it('throws fast when a required LiveKit env var is missing', () => {
    delete process.env.LIVEKIT_URL;
    expect(() => new LiveKitClientAdapter()).toThrow(/LIVEKIT_URL/);
  });

  it('checkReachable returns true when listRooms succeeds', async () => {
    listRooms.mockResolvedValue([]);
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.checkReachable()).toBe(true);
  });

  it('checkReachable returns false when listRooms throws (LiveKit unreachable)', async () => {
    listRooms.mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.checkReachable()).toBe(false);
  });

  it('createRoom returns created on success', async () => {
    createRoom.mockResolvedValue({});
    const adapter = new LiveKitClientAdapter();
    const outcome = await adapter.createRoom({ roomName: 'acme_s1', metadata: { tenant_id: 't1' } });
    expect(outcome).toEqual({ kind: 'created' });
    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'acme_s1', metadata: JSON.stringify({ tenant_id: 't1' }) }),
    );
  });

  it('createRoom returns capacity on a 4xx-shaped rejection', async () => {
    createRoom.mockRejectedValue(Object.assign(new Error('rejected'), { status: 429 }));
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.createRoom({ roomName: 'acme_s1', metadata: {} })).toEqual({ kind: 'capacity' });
  });

  it('createRoom returns unavailable on a connection-shaped failure', async () => {
    createRoom.mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.createRoom({ roomName: 'acme_s1', metadata: {} })).toEqual({ kind: 'unavailable' });
  });

  it('deleteRoom never throws even when the SDK call fails (best-effort)', async () => {
    deleteRoom.mockRejectedValue(new Error('not found'));
    const adapter = new LiveKitClientAdapter();
    await expect(adapter.deleteRoom('acme_s1')).resolves.toBeUndefined();
  });

  it('mintToken builds a room-scoped grant and returns the signed JWT', async () => {
    toJwt.mockResolvedValue('signed.jwt.token');
    const adapter = new LiveKitClientAdapter();
    const token = await adapter.mintToken({
      roomName: 'acme_s1',
      identity: 'user_s1',
      canPublish: true,
      canSubscribe: true,
      ttlSeconds: 7200,
    });
    expect(token).toBe('signed.jwt.token');
    expect(addGrant).toHaveBeenCalledWith({
      roomJoin: true,
      room: 'acme_s1',
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('verifyToken returns identity/room on a valid token', async () => {
    verify.mockResolvedValue({ sub: 'user_s1', video: { room: 'acme_s1' } });
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.verifyToken('a.b.c')).toEqual({ identity: 'user_s1', roomName: 'acme_s1' });
  });

  it('verifyToken returns null when the signature/claims are invalid', async () => {
    verify.mockRejectedValue(new Error('bad signature'));
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.verifyToken('bad')).toBeNull();
  });

  it('verifyToken returns null when claims are missing sub or room', async () => {
    verify.mockResolvedValue({ sub: undefined, video: { room: 'acme_s1' } });
    const adapter = new LiveKitClientAdapter();
    expect(await adapter.verifyToken('a.b.c')).toBeNull();
  });

  it('createAgentDispatch is fire-and-forget: a failure never throws', async () => {
    createDispatch.mockRejectedValue(new Error('no worker registered'));
    const adapter = new LiveKitClientAdapter();
    await expect(
      adapter.createAgentDispatch({ roomName: 'acme_s1', agentName: 'avatar-agent', metadata: {} }),
    ).resolves.toBeUndefined();
  });

  it('verifyWebhook returns the decoded event on a valid signature', async () => {
    // `WebhookReceiver.receive()` is async in the real SDK — mocking it as
    // `mockResolvedValue` (not `mockReturnValue`) is what catches a missing
    // `await` in the adapter (QA Phase 3 D-1: the prior synchronous mock hid
    // this bug from the whole regression suite).
    receive.mockResolvedValue({ event: 'participant_joined', room: { name: 'acme_s1' } });
    const adapter = new LiveKitClientAdapter();
    await expect(adapter.verifyWebhook('{}', 'sig')).resolves.toEqual({
      event: 'participant_joined',
      room: { name: 'acme_s1' },
    });
  });

  it('verifyWebhook returns null on an invalid signature', async () => {
    receive.mockRejectedValue(new Error('invalid signature'));
    const adapter = new LiveKitClientAdapter();
    await expect(adapter.verifyWebhook('{}', 'bad-sig')).resolves.toBeNull();
  });

  it('verifyWebhook awaits receive() so a rejection cannot escape as an unhandled rejection', async () => {
    // Regression guard for QA Phase 3 D-1: if `verifyWebhook` ever loses its
    // `await` again, this assertion fails because the returned value would be
    // a pending Promise (always truthy) rather than `null`.
    receive.mockRejectedValue(new Error('Invalid Compact JWS'));
    const adapter = new LiveKitClientAdapter();
    const result = await adapter.verifyWebhook('{}', 'garbage-sig');
    expect(result).toBeNull();
  });
});
