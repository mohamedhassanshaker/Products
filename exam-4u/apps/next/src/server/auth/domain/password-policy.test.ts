import { describe, expect, it } from 'vitest';
import { evaluatePasswordPolicy } from './password-policy';
import type { PasswordPolicy } from './auth.types';

const FULL_POLICY: PasswordPolicy = { minLength: 8, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: true };

describe('evaluatePasswordPolicy', () => {
  it('returns no violations for a password satisfying every rule', () => {
    expect(evaluatePasswordPolicy('Abcdef1!', FULL_POLICY)).toEqual([]);
  });

  it('reports every unmet rule, not just the first, in the fixed order length/upper/lower/digit/symbol', () => {
    const violations = evaluatePasswordPolicy('a', FULL_POLICY);
    expect(violations).toEqual([
      'Password must be at least 8 characters long.',
      'Password must include at least one uppercase letter.',
      'Password must include at least one digit.',
      'Password must include at least one symbol (non-alphanumeric character).',
    ]);
  });

  it('flags a too-short password', () => {
    expect(evaluatePasswordPolicy('Ab1!', FULL_POLICY)).toContain('Password must be at least 8 characters long.');
  });

  it('flags a missing uppercase letter', () => {
    expect(evaluatePasswordPolicy('lowercase1!', FULL_POLICY)).toContain('Password must include at least one uppercase letter.');
  });

  it('flags a missing lowercase letter', () => {
    expect(evaluatePasswordPolicy('UPPERCASE1!', FULL_POLICY)).toContain('Password must include at least one lowercase letter.');
  });

  it('flags a missing digit', () => {
    expect(evaluatePasswordPolicy('NoDigitsHere!', FULL_POLICY)).toContain('Password must include at least one digit.');
  });

  it('flags a missing symbol', () => {
    expect(evaluatePasswordPolicy('NoSymbol123', FULL_POLICY)).toContain(
      'Password must include at least one symbol (non-alphanumeric character).',
    );
  });

  it('does not require a symbol when requireSymbol is false (the default policy shape)', () => {
    const policy: PasswordPolicy = { ...FULL_POLICY, requireSymbol: false };
    expect(evaluatePasswordPolicy('Abcdefg1', policy)).toEqual([]);
  });
});
