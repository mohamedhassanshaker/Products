import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateResetToken, hashResetToken } from './reset-token';

describe('generateResetToken', () => {
  it('generates a 64-char lowercase-hex token and a matching 64-char SHA-256 hash', () => {
    const { token, tokenHash } = generateResetToken(60);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
  });

  it('never stores the plaintext token — tokenHash differs from token', () => {
    const { token, tokenHash } = generateResetToken(60);
    expect(tokenHash).not.toBe(token);
  });

  it('sets expiresAt to now + ttlMinutes minutes', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { expiresAt } = generateResetToken(60, now);
    expect(expiresAt.toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('generates a different token on every call (high-entropy randomness)', () => {
    const a = generateResetToken(60);
    const b = generateResetToken(60);
    expect(a.token).not.toBe(b.token);
  });
});

describe('hashResetToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'));
  });

  it('matches Node\'s own sha256 hex digest', () => {
    expect(hashResetToken('some-token')).toBe(createHash('sha256').update('some-token', 'utf8').digest('hex'));
  });
});
