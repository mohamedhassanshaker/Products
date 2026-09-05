import type { PasswordPolicy } from './auth.types';

/**
 * Evaluates `password` against `policy`, returning **every** unmet rule (not just the first) in this
 * fixed order: length → upper → lower → digit → symbol — ported verbatim from
 * `legacy/api/src/modules/auth/domain/password-policy.ts`. An empty result means the password passes.
 * Pure, synchronous, no I/O — used identically by `register`, `resetPassword`, and `changePassword`.
 */
export function evaluatePasswordPolicy(password: string, policy: PasswordPolicy): string[] {
  const violations: string[] = [];

  if (password.length < policy.minLength) {
    violations.push(`Password must be at least ${policy.minLength} characters long.`);
  }
  if (policy.requireUpper && !/[A-Z]/.test(password)) {
    violations.push('Password must include at least one uppercase letter.');
  }
  if (policy.requireLower && !/[a-z]/.test(password)) {
    violations.push('Password must include at least one lowercase letter.');
  }
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    violations.push('Password must include at least one digit.');
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    violations.push('Password must include at least one symbol (non-alphanumeric character).');
  }

  return violations;
}
