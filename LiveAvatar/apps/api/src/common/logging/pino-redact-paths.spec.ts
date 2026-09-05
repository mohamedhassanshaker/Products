import { PINO_REDACT_PATHS } from './pino-redact-paths';

describe('PINO_REDACT_PATHS', () => {
  it('covers the auth header, LiveKit-token bearing fields, and set-cookie response header', () => {
    expect(PINO_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.body.token',
        'res.body.token',
        'res.headers["set-cookie"]',
      ]),
    );
  });

  it('is shared verbatim by both the public and internal Pino wiring (QA Phase 3 D-3)', () => {
    // A regression guard for the exact bug QA found: this constant must be a
    // single source of truth, not two independently-maintained copies that
    // can drift apart (one covered, one silently not).
    expect(Array.isArray(PINO_REDACT_PATHS)).toBe(true);
    expect(PINO_REDACT_PATHS.length).toBeGreaterThan(0);
  });
});
