import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type LoggerOptions } from 'pino';
import { getEnv } from '@/server/config';

/**
 * Field paths pino redacts before a log line is ever serialized — ported verbatim from
 * `legacy/api/src/infrastructure/logging/logger.module.ts`'s `LOG_REDACT_PATHS` (secrets/PII never
 * hit disk or stdout in plaintext). Wildcards cover the field appearing at any nesting depth, since
 * call sites pass arbitrary object shapes.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  'password',
  'passwordHash',
  'token',
];

/**
 * Ensures `dir` exists, tolerating failure. Called at boot, before the pino logger itself exists, so
 * a failure here is reported via `process.stderr` directly rather than `logger.*` — the one
 * deliberate, documented exception to "no `console.*`/raw stderr writes anywhere" for this
 * chicken-and-egg bootstrap moment, ported verbatim from the legacy `ensureLogDirectory`.
 *
 * @returns `true` if the directory is usable, `false` if it could not be created — in which case the
 *   caller falls back to stdout-only logging rather than letting a log-directory problem prevent the
 *   process from starting (a logging failure must never throw into the request/process it's meant to
 *   observe).
 */
function ensureLogDirectory(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    process.stderr.write(
      `[logging] could not create LOG_DIR "${dir}", falling back to stdout-only logging: ${String(err)}\n`,
    );
    return false;
  }
}

/**
 * Builds the pino options for the process-wide logger: dual stdout + dated-rolling-file sink,
 * redaction, and level — ported pattern from `legacy/api`'s `buildPinoHttpOptions`, adapted from
 * `nestjs-pino`'s `pinoHttp` shape (which doesn't apply here — no NestJS/no per-request HTTP
 * middleware pipeline in a Next.js Route Handler) to a plain `pino()` options object. Exported as a
 * pure-ish function (its only side effect is the directory check above) so it's directly
 * unit-testable without constructing a real logger.
 */
export function buildPinoOptions(logDir: string, level: string): LoggerOptions {
  const fileSinkAvailable = ensureLogDirectory(logDir);

  const targets: { target: string; level: string; options?: Record<string, unknown> }[] = [
    { target: 'pino/file', level, options: { destination: 1 } }, // stdout (fd 1)
  ];

  if (fileSinkAvailable) {
    targets.push({
      target: 'pino-roll',
      level,
      options: {
        file: join(logDir, 'examland-next'),
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        extension: '.log',
        mkdir: true,
        // pino-roll runs its file writer in a worker thread; a disk error there surfaces as a
        // stream 'error' event rather than a synchronous throw into request-handling code — this is
        // what lets a full disk degrade logging instead of failing the triggering request.
      },
    });
  }

  return {
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    transport: { targets },
  };
}

/** Constructs the actual pino instance. Kept as its own function (rather than inline in the
 * `index.ts` barrel) purely for unit-testability — {@link buildPinoOptions} and this are exercised
 * independently of the `globalThis` caching `index.ts` adds. */
export function createLogger(): pino.Logger {
  const env = getEnv();
  return pino(buildPinoOptions(env.LOG_DIR, env.LOG_LEVEL));
}
