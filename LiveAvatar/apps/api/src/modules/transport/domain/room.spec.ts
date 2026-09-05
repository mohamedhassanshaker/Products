import {
  agentIdentity,
  buildRoomName,
  DEFAULT_MAX_DURATION_SECONDS,
  tokenTtlSeconds,
  userIdentity,
} from './room';

describe('room domain helpers', () => {
  it('builds the room name as {room_namespace}_{session_id} (FR-TRANSPORT-1)', () => {
    expect(buildRoomName('acme', 'session-1')).toBe('acme_session-1');
  });

  it('builds the user identity with the user_ prefix (FR-AUTH-4)', () => {
    expect(userIdentity('session-1')).toBe('user_session-1');
  });

  it('builds the agent identity with the agent_ prefix (FR-AUTH-4)', () => {
    expect(agentIdentity('session-1')).toBe('agent_session-1');
  });

  it('caps token TTL at 2 hours when max_duration is longer', () => {
    expect(tokenTtlSeconds(10_000)).toBe(DEFAULT_MAX_DURATION_SECONDS);
  });

  it('uses max_duration when it is shorter than 2 hours', () => {
    expect(tokenTtlSeconds(600)).toBe(600);
  });
});
