import { formatRelativeTime } from './relative-time';

const NOW = new Date('2026-08-19T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('returns "just now" for sub-5-second differences', () => {
    expect(formatRelativeTime('2026-08-19T11:59:58.000Z', NOW)).toBe('just now');
  });

  it('formats minutes ago', () => {
    expect(formatRelativeTime('2026-08-19T11:55:00.000Z', NOW)).toBe('5 minutes ago');
  });

  it('formats hours ago', () => {
    expect(formatRelativeTime('2026-08-19T10:00:00.000Z', NOW)).toBe('2 hours ago');
  });

  it('formats days ago', () => {
    expect(formatRelativeTime('2026-08-17T12:00:00.000Z', NOW)).toBe('2 days ago');
  });

  it('formats future times', () => {
    expect(formatRelativeTime('2026-08-19T12:05:00.000Z', NOW)).toBe('in 5 minutes');
  });

  it('formats weeks and months ago', () => {
    expect(formatRelativeTime('2026-08-01T12:00:00.000Z', NOW)).toBe('3 weeks ago');
    expect(formatRelativeTime('2026-05-19T12:00:00.000Z', NOW)).toBe('3 months ago');
  });

  it('formats years ago', () => {
    expect(formatRelativeTime('2024-08-19T12:00:00.000Z', NOW)).toBe('2 years ago');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});
