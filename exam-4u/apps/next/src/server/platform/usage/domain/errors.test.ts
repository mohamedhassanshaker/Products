import { describe, expect, it } from 'vitest';
import { FeatureLimitReachedError, FeatureNotEnabledError } from './errors';

/** Ported verbatim from `legacy/api/src/platform/usage/domain/errors.spec.ts`. */

describe('FeatureNotEnabledError', () => {
  it('carries the FEATURE_NOT_ENABLED code', () => {
    const err = new FeatureNotEnabledError('exams.create');
    expect(err.code).toBe('FEATURE_NOT_ENABLED');
  });
});

describe('FeatureLimitReachedError', () => {
  it('FR-PKG-5: names the feature, limit, and resetsAt (ISO string) in details', () => {
    const resetsAt = new Date('2026-09-01T00:00:00.000Z');
    const err = new FeatureLimitReachedError('exams.create', 5, resetsAt);
    expect(err.code).toBe('FEATURE_LIMIT_REACHED');
    expect(err.details).toEqual({ feature: 'exams.create', limit: 5, resetsAt: '2026-09-01T00:00:00.000Z' });
  });

  it('reports a null resetsAt for a lifetime (NONE) cap', () => {
    const err = new FeatureLimitReachedError('exams.total', 3, null);
    expect(err.details?.resetsAt).toBeNull();
  });
});
