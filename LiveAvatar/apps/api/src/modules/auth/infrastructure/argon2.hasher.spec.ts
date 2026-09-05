import { Argon2Hasher } from './argon2.hasher';

describe('Argon2Hasher', () => {
  const hasher = new Argon2Hasher();

  it(
    'hashes and verifies a password round-trip',
    async () => {
      const hash = await hasher.hash('correct horse battery staple');
      expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(true);
    },
    20000,
  );

  it(
    'rejects the wrong password',
    async () => {
      const hash = await hasher.hash('correct horse battery staple');
      expect(await hasher.verify(hash, 'wrong password')).toBe(false);
    },
    20000,
  );
});
