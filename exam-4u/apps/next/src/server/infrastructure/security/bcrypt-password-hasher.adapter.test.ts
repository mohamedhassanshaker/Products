import { describe, expect, it } from 'vitest';
import { BcryptPasswordHasherAdapter } from './bcrypt-password-hasher.adapter';

describe('BcryptPasswordHasherAdapter', () => {
  // Low cost factor (4, the minimum the env schema allows) so this suite stays fast.
  const adapter = new BcryptPasswordHasherAdapter(4);

  it('hashes a password to a non-plaintext bcrypt hash', async () => {
    const hash = await adapter.hash('Sup3rSecret!');
    expect(hash).not.toBe('Sup3rSecret!');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('compares the correct password successfully', async () => {
    const hash = await adapter.hash('Sup3rSecret!');
    await expect(adapter.compare('Sup3rSecret!', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await adapter.hash('Sup3rSecret!');
    await expect(adapter.compare('WrongPassword', hash)).resolves.toBe(false);
  });

  it('never throws for a malformed/foreign-format hash — normalizes to false', async () => {
    await expect(adapter.compare('anything', 'not-a-real-bcrypt-hash')).resolves.toBe(false);
  });
});
