import { describe, expect, it } from 'vitest';
import { isPdfSignature } from './pdf-signature.util';

describe('isPdfSignature', () => {
  it('recognizes a genuine PDF signature at offset 0', () => {
    expect(isPdfSignature(Buffer.from('%PDF-1.7\n%rest of a real pdf', 'ascii'))).toBe(true);
  });

  it('tolerates a small amount of leading garbage before the signature', () => {
    const buffer = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from('%PDF-1.4', 'ascii')]);
    expect(isPdfSignature(buffer)).toBe(true);
  });

  it('rejects a non-PDF buffer', () => {
    expect(isPdfSignature(Buffer.from('this is definitely not a pdf file'))).toBe(false);
  });

  it('rejects a too-short buffer', () => {
    expect(isPdfSignature(Buffer.from([0x25, 0x50]))).toBe(false);
  });

  it('rejects a buffer whose only "%PDF-" occurrence falls outside the sniff window', () => {
    const padding = Buffer.alloc(2000, 0x20);
    const buffer = Buffer.concat([padding, Buffer.from('%PDF-1.7', 'ascii')]);
    expect(isPdfSignature(buffer)).toBe(false);
  });

  it('never trusts a client-supplied filename/extension — only the real leading bytes matter', () => {
    expect(isPdfSignature(Buffer.from('exam.pdf file contents here but not a real pdf'))).toBe(false);
  });
});
