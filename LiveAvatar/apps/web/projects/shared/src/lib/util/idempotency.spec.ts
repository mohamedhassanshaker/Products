import { createIdempotencyKey } from './idempotency';

describe('createIdempotencyKey', () => {
  it('returns a v4-shaped UUID string', () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns a fresh key on every call', () => {
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });
});
