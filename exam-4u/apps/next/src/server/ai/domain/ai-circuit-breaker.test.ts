import { describe, expect, it, vi } from 'vitest';
import { AiCircuitBreaker } from './ai-circuit-breaker';

describe('AiCircuitBreaker', () => {
  it('starts closed and allows requests', () => {
    const breaker = new AiCircuitBreaker(5, 30_000);
    expect(breaker.getState()).toBe('closed');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('opens after `failureThreshold` consecutive failures', () => {
    const breaker = new AiCircuitBreaker(3, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');
    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
  });

  it('rejects every request while open (no network I/O, <10ms per the port doc comment)', () => {
    const breaker = new AiCircuitBreaker(1, 30_000);
    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
    expect(breaker.allowRequest()).toBe(false);
  });

  it('a success resets the failure count and closes the breaker', () => {
    const breaker = new AiCircuitBreaker(3, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    // Two more failures after the reset — still below threshold (3), so still closed.
    expect(breaker.getState()).toBe('closed');
  });

  it('half-opens after `openDurationMs` and allows exactly one probe', () => {
    vi.useFakeTimers();
    try {
      const breaker = new AiCircuitBreaker(1, 30_000);
      breaker.recordFailure();
      expect(breaker.getState()).toBe('open');

      vi.advanceTimersByTime(30_001);
      expect(breaker.getState()).toBe('half-open');

      // First call after half-open is allowed (the probe slot).
      expect(breaker.allowRequest()).toBe(true);
      // A second concurrent call while the probe is in flight is rejected.
      expect(breaker.allowRequest()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed half-open probe re-opens the breaker and restarts the open-duration clock', () => {
    vi.useFakeTimers();
    try {
      const breaker = new AiCircuitBreaker(1, 30_000);
      breaker.recordFailure();
      vi.advanceTimersByTime(30_001);
      expect(breaker.getState()).toBe('half-open');
      breaker.allowRequest(); // consume the probe slot
      breaker.recordFailure(); // the probe itself failed
      expect(breaker.getState()).toBe('open');

      // Immediately after re-opening, it must not yet be half-open again (clock restarted).
      vi.advanceTimersByTime(1);
      expect(breaker.getState()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a successful half-open probe fully closes the breaker', () => {
    vi.useFakeTimers();
    try {
      const breaker = new AiCircuitBreaker(1, 30_000);
      breaker.recordFailure();
      vi.advanceTimersByTime(30_001);
      breaker.allowRequest();
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.allowRequest()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
