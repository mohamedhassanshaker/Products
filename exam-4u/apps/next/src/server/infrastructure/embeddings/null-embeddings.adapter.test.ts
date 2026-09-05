import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullEmbeddingsAdapter } from './null-embeddings.adapter';

/** `NodeJS.ProcessEnv['NODE_ENV']` is typed `readonly` by `@types/node`/Next's own global
 * augmentation (the same reason `env.schema.test.ts`'s own "rejects an unknown NODE_ENV value" test
 * needs an `as unknown as` cast) — a plain mutable-env-var setter is needed here since
 * `NullEmbeddingsAdapter`'s constructor reads `process.env.NODE_ENV` directly (its own
 * defense-in-depth check, independent of `getEnv()`), so this helper is the smallest way to flip it
 * for one test without fighting the type system on every call site. */
function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true, writable: true, enumerable: true });
}

describe('NullEmbeddingsAdapter', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    setNodeEnv('test');
    process.env.EMBEDDING_DIMS = '8';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
    delete process.env.EMBEDDING_DIMS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  it('refuses to construct in NODE_ENV=production (defense-in-depth, HLD §7.2-equivalent)', () => {
    setNodeEnv('production');
    expect(() => new NullEmbeddingsAdapter()).toThrow(/must never be used in NODE_ENV=production/);
  });

  it('constructs fine in development/test', () => {
    expect(() => new NullEmbeddingsAdapter()).not.toThrow();
  });

  it('model is a fixed, clearly-non-real-provider label', () => {
    expect(new NullEmbeddingsAdapter().model).toBe('null-hash-embeddings');
  });

  it('dims reflects the configured EMBEDDING_DIMS', () => {
    expect(new NullEmbeddingsAdapter().dims).toBe(8);
  });

  it('embed() is deterministic — the same text always produces the same vector', async () => {
    const adapter = new NullEmbeddingsAdapter();
    const [a] = await adapter.embed(['hello world']);
    const [b] = await adapter.embed(['hello world']);
    expect(a).toEqual(b);
  });

  it('embed() produces a different vector for different text', async () => {
    const adapter = new NullEmbeddingsAdapter();
    const [a] = await adapter.embed(['hello world']);
    const [b] = await adapter.embed(['goodbye world']);
    expect(a).not.toEqual(b);
  });

  it('embed() is order-preserving and returns one vector per input text of the configured length', async () => {
    const adapter = new NullEmbeddingsAdapter();
    const vectors = await adapter.embed(['a', 'b', 'c']);
    expect(vectors).toHaveLength(3);
    for (const v of vectors) {
      expect(v).toHaveLength(8);
      for (const component of v) {
        expect(component).toBeGreaterThanOrEqual(-1);
        expect(component).toBeLessThan(1);
      }
    }
  });

  it('embed([]) returns []', async () => {
    expect(await new NullEmbeddingsAdapter().embed([])).toEqual([]);
  });
});
