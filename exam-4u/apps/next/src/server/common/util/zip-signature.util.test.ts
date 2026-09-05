import { describe, expect, it } from 'vitest';
import { isZipMagicBytes } from './zip-signature.util';

describe('isZipMagicBytes', () => {
  it('recognizes a local-file-header ZIP signature (PK\\x03\\x04)', () => {
    expect(isZipMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(true);
  });

  it('recognizes an empty-archive end-of-central-directory signature (PK\\x05\\x06)', () => {
    expect(isZipMagicBytes(Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00]))).toBe(true);
  });

  it('rejects a non-ZIP buffer', () => {
    expect(isZipMagicBytes(Buffer.from('this is definitely not a zip file'))).toBe(false);
  });

  it('rejects a too-short buffer', () => {
    expect(isZipMagicBytes(Buffer.from([0x50, 0x4b]))).toBe(false);
  });

  it('never trusts a client-supplied filename/extension — only the real leading bytes matter', () => {
    // A buffer that merely contains the letters "zip" somewhere is not remotely the same as one
    // whose first four bytes are the real signature.
    expect(isZipMagicBytes(Buffer.from('exam.zip file contents here but not a real archive'))).toBe(false);
  });
});
