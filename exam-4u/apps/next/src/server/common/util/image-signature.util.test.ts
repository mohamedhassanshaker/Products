import { describe, expect, it } from 'vitest';
import { extensionForImageType, sniffImageMimeType } from './image-signature.util';

describe('sniffImageMimeType', () => {
  it('recognizes a JPEG signature', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageMimeType(buf)).toBe('image/jpeg');
  });

  it('recognizes a PNG signature', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(sniffImageMimeType(buf)).toBe('image/png');
  });

  it('recognizes a WebP signature (RIFF....WEBP)', () => {
    const buf = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
    expect(sniffImageMimeType(buf)).toBe('image/webp');
  });

  it('returns null for an unrecognized signature', () => {
    expect(sniffImageMimeType(Buffer.from('not an image'))).toBeNull();
  });

  it('returns null for a too-short buffer', () => {
    expect(sniffImageMimeType(Buffer.from([0xff]))).toBeNull();
  });

  it('never trusts a client-supplied extension/label — only the real bytes matter', () => {
    // A buffer with a ".png"-suggestive name would still fail here since sniffing never looks at
    // any filename — only the actual content is passed in.
    const fakePng = Buffer.from('this is plainly not a real PNG file despite what a filename might claim');
    expect(sniffImageMimeType(fakePng)).toBeNull();
  });
});

describe('extensionForImageType', () => {
  it('maps every sniffed type to its fixed, safe extension', () => {
    expect(extensionForImageType('image/jpeg')).toBe('jpg');
    expect(extensionForImageType('image/png')).toBe('png');
    expect(extensionForImageType('image/webp')).toBe('webp');
  });
});
