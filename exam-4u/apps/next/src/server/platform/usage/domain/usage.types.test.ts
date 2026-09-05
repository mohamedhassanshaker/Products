import { describe, expect, it } from 'vitest';
import { derivePeriodKey, deriveResetsAt } from './usage.types';

/** Ported verbatim from `legacy/api/src/platform/usage/domain/usage.types.spec.ts`. */

describe('derivePeriodKey', () => {
  it('MONTHLY -> YYYY-MM (UTC)', () => {
    expect(derivePeriodKey('MONTHLY', new Date('2026-08-09T23:59:00Z'))).toBe('2026-08');
  });

  it('DAILY -> YYYY-MM-DD (UTC)', () => {
    expect(derivePeriodKey('DAILY', new Date('2026-08-09T23:59:00Z'))).toBe('2026-08-09');
  });

  it("NONE -> the literal 'lifetime' (never resets)", () => {
    expect(derivePeriodKey('NONE', new Date('2026-08-09T23:59:00Z'))).toBe('lifetime');
  });
});

describe('deriveResetsAt', () => {
  it('MONTHLY resolves to the 1st of next month at UTC midnight', () => {
    expect(deriveResetsAt('MONTHLY', new Date('2026-08-09T12:00:00Z'))?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('MONTHLY correctly rolls over the year boundary', () => {
    expect(deriveResetsAt('MONTHLY', new Date('2026-12-15T12:00:00Z'))?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('DAILY resolves to the next UTC midnight', () => {
    expect(deriveResetsAt('DAILY', new Date('2026-08-09T12:00:00Z'))?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('NONE never resets (null)', () => {
    expect(deriveResetsAt('NONE', new Date('2026-08-09T12:00:00Z'))).toBeNull();
  });
});
