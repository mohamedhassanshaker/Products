import { Sha256TokenDigest } from './sha256-digest';

describe('Sha256TokenDigest', () => {
  const digest = new Sha256TokenDigest();

  it('digest is deterministic and hex-encoded', () => {
    expect(digest.digest('token')).toBe(digest.digest('token'));
    expect(digest.digest('token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('randomToken returns a unique url-safe string each call', () => {
    expect(digest.randomToken()).not.toBe(digest.randomToken());
  });

  it('randomFamilyId returns a UUID', () => {
    expect(digest.randomFamilyId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
