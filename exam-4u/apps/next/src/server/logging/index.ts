import type pino from 'pino';
import { createLogger } from './logger';

/**
 * `server/logging`'s public barrel. Every consumer imports {@link logger} from here — no
 * `console.*` anywhere in `src/server/**`/`src/app/**` (LLD §12.5 convention, ported); nothing
 * outside this module may import `./logger` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `logging` module-boundary rule).
 *
 * Cached on `globalThis` for the identical Next.js dev-mode hot-reload reason documented in
 * `server/config/index.ts` and `server/infrastructure/database/index.ts` — without this, every
 * edit-triggered module re-evaluation during `next dev` would construct a brand-new pino instance
 * (and, worse, a brand-new `pino-roll` file-transport worker thread per reload).
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandLogger: pino.Logger | undefined;
}

function getLogger(): pino.Logger {
  if (!globalThis.__examlandLogger) {
    globalThis.__examlandLogger = createLogger();
  }
  return globalThis.__examlandLogger;
}

/** The process-wide structured logger singleton. Log messages should be `snake.case` event names
 * with structured fields (e.g. `logger.info({ schema }, 'platform_datasource.connected')`), never
 * interpolated prose — LLD §12.5 convention, ported. */
export const logger: pino.Logger = getLogger();
