import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { DestinationStream } from 'pino';

/**
 * Fail-safe daily file sink for Pino. Disk/permission errors are swallowed so
 * a logging failure never throws into the request that triggered it.
 * @param logsDir - Directory (created if missing)
 * @returns Pino destination
 */
export function createFailSafeFileDestination(logsDir: string): DestinationStream {
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    return { write: () => true };
  }

  let stream: WriteStream | null = null;
  let currentDay = '';

  const openForToday = (): WriteStream | null => {
    const day = new Date().toISOString().slice(0, 10);
    if (stream && currentDay === day) {
      return stream;
    }
    try {
      stream?.end();
    } catch {
      /* ignore */
    }
    currentDay = day;
    try {
      stream = createWriteStream(join(logsDir, `${day}.log`), { flags: 'a' });
      stream.on('error', () => {
        stream = null;
      });
      return stream;
    } catch {
      stream = null;
      return null;
    }
  };

  return {
    write(msg: string) {
      try {
        openForToday()?.write(msg);
      } catch {
        /* fail-safe */
      }
      return true;
    },
  };
}
