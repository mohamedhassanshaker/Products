import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFailSafeFileDestination } from './file-logger';

describe('createFailSafeFileDestination', () => {
  it('creates the directory and writes a line to today\'s file', async () => {
    const dir = join(tmpdir(), `liveavatar-log-test-${Date.now()}`);
    const dest = createFailSafeFileDestination(dir);
    dest.write('{"level":30,"msg":"hello"}\n');
    // createWriteStream opens asynchronously; give it a tick to flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const day = new Date().toISOString().slice(0, 10);
    const file = join(dir, `${day}.log`);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('hello');
    rmSync(dir, { recursive: true, force: true });
  });

  it('is fail-safe when the directory cannot be created', () => {
    // A path through a file (not a directory) as a parent forces mkdirSync to fail.
    const blocker = join(tmpdir(), `liveavatar-log-blocker-${Date.now()}.txt`);
    writeFileSync(blocker, 'x');
    const dest = createFailSafeFileDestination(join(blocker, 'nested'));
    expect(() => dest.write('anything')).not.toThrow();
    rmSync(blocker, { force: true });
  });

  it('reuses the same stream within the same day and returns true from write', () => {
    const dir = join(tmpdir(), `liveavatar-log-test2-${Date.now()}`);
    const dest = createFailSafeFileDestination(dir);
    expect(dest.write('line1\n')).toBe(true);
    expect(dest.write('line2\n')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
