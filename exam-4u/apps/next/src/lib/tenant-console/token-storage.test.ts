import { afterEach, describe, expect, it } from 'vitest';
import { clearStoredTenantToken, getStoredTenantToken, setStoredTenantToken } from './token-storage';

/** Runs under the `node` environment — exercises both the "no browser `window`" no-op branch and the
 * real-browser branch (via a minimal stubbed `window.localStorage`), matching
 * `lib/platform-console/token-storage.test.ts`'s identical structure. */
describe('token-storage (tenant realm)', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('every function is a safe no-op when window is undefined (SSR/non-browser context)', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(getStoredTenantToken()).toBeNull();
    expect(() => setStoredTenantToken('x')).not.toThrow();
    expect(() => clearStoredTenantToken()).not.toThrow();
  });

  it('set/get/clear round-trip through a real (stubbed) window.localStorage', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    };

    expect(getStoredTenantToken()).toBeNull();
    setStoredTenantToken('a-token');
    expect(getStoredTenantToken()).toBe('a-token');
    clearStoredTenantToken();
    expect(getStoredTenantToken()).toBeNull();
  });
});
