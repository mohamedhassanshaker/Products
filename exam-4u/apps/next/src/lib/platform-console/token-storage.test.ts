import { afterEach, describe, expect, it } from 'vitest';
import { clearStoredPlatformToken, getStoredPlatformToken, setStoredPlatformToken } from './token-storage';

/** Runs under the `node` environment (no `window` global exists by default) — exercises both the
 * "no browser `window`" no-op branch (this file's own SSR-safety guard) and the real-browser branch
 * (via a minimal stubbed `window.localStorage`), so both sides of every function's guard are proven,
 * not just the happy path. */
describe('token-storage', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('every function is a safe no-op when window is undefined (SSR/non-browser context)', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(getStoredPlatformToken()).toBeNull();
    expect(() => setStoredPlatformToken('x')).not.toThrow();
    expect(() => clearStoredPlatformToken()).not.toThrow();
  });

  it('set/get/clear round-trip through a real (stubbed) window.localStorage', () => {
    const store = new Map<string, string>();
    beforeEachWindowStub(store);

    expect(getStoredPlatformToken()).toBeNull();
    setStoredPlatformToken('a-token');
    expect(getStoredPlatformToken()).toBe('a-token');
    clearStoredPlatformToken();
    expect(getStoredPlatformToken()).toBeNull();
  });

  function beforeEachWindowStub(store: Map<string, string>) {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    };
  }
});
