import { isTerminalStatus, nextStatus } from './session-status';

describe('session status machine (LLD §8.1, FR-TRANSPORT-4)', () => {
  it('pending -> active on the first join event', () => {
    expect(nextStatus('pending', 'active')).toBe('active');
  });

  it('active -> active is a legal no-op re-application', () => {
    expect(nextStatus('active', 'active')).toBe('active');
  });

  it('pending/active/degraded -> degraded on impairment (FR-LLM-2/FR-AVATAR-5)', () => {
    expect(nextStatus('pending', 'degraded')).toBe('degraded');
    expect(nextStatus('active', 'degraded')).toBe('degraded');
    expect(nextStatus('degraded', 'degraded')).toBe('degraded');
  });

  it('any non-terminal status -> failed', () => {
    expect(nextStatus('pending', 'failed')).toBe('failed');
    expect(nextStatus('active', 'failed')).toBe('failed');
    expect(nextStatus('degraded', 'failed')).toBe('failed');
  });

  it('any non-terminal status -> ended', () => {
    expect(nextStatus('pending', 'ended')).toBe('ended');
    expect(nextStatus('active', 'ended')).toBe('ended');
  });

  it('only pending -> abandoned (the 15-minute sweeper)', () => {
    expect(nextStatus('pending', 'abandoned')).toBe('abandoned');
    expect(nextStatus('active', 'abandoned')).toBeNull();
  });

  it('a duplicate end-call keeps ended (idempotent no-op)', () => {
    expect(nextStatus('ended', 'ended')).toBeNull();
  });

  it('a late failed event after ended is dropped', () => {
    expect(nextStatus('ended', 'failed')).toBeNull();
  });

  it('abandoned and failed are also terminal', () => {
    expect(nextStatus('abandoned', 'active')).toBeNull();
    expect(nextStatus('failed', 'ended')).toBeNull();
  });

  it('isTerminalStatus reports ended/failed/abandoned as terminal, others as not', () => {
    expect(isTerminalStatus('ended')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('abandoned')).toBe(true);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('active')).toBe(false);
    expect(isTerminalStatus('degraded')).toBe(false);
  });
});
