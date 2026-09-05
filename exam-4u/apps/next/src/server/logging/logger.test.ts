import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPinoOptions, LOG_REDACT_PATHS } from './logger';

describe('buildPinoOptions', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('includes the redaction paths that keep secrets/PII out of log output', () => {
    expect(LOG_REDACT_PATHS).toContain('password');
    expect(LOG_REDACT_PATHS).toContain('*.token');
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('always includes a stdout target, and adds a pino-roll file target when the dir is writable', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'examland-next-log-test-'));
    const options = buildPinoOptions(tempDir, 'debug');
    expect(options.level).toBe('debug');
    const targets = (options.transport as { targets: { target: string }[] }).targets;
    expect(targets.some((t) => t.target === 'pino/file')).toBe(true);
    expect(targets.some((t) => t.target === 'pino-roll')).toBe(true);
  });

  it('falls back to stdout-only (never throws) when the log directory cannot be created', () => {
    // A path nested under a file (not a directory) can never be `mkdir -p`'d — deliberately
    // triggers the fail-safe fallback branch (NFR-6a-equivalent: "a logging failure never throws
    // into the request/process it's meant to observe").
    tempDir = mkdtempSync(join(tmpdir(), 'examland-next-log-test-'));
    const blockingFile = join(tempDir, 'not-a-directory');
    writeFileSync(blockingFile, 'x');
    const impossiblePath = join(blockingFile, 'nested', 'logs');

    let options: ReturnType<typeof buildPinoOptions> | undefined;
    expect(() => {
      options = buildPinoOptions(impossiblePath, 'info');
    }).not.toThrow();

    const targets = (options!.transport as { targets: { target: string }[] }).targets;
    expect(targets.some((t) => t.target === 'pino/file')).toBe(true);
    expect(targets.some((t) => t.target === 'pino-roll')).toBe(false);
  });
});
