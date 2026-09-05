import { utf8ByteLength } from './byte-length.util';

describe('utf8ByteLength', () => {
  it('matches String.length for plain ASCII', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts UTF-8 bytes, not UTF-16 code units, for multi-byte characters', () => {
    // U+1F642 SLIGHTLY SMILING FACE — 2 UTF-16 code units (a surrogate
    // pair), but 4 UTF-8 bytes. A naive `.length` (2) would under-count the
    // real wire size (FR-CONFIG-2's 32,768-byte limit).
    expect('🙂'.length).toBe(2);
    expect(utf8ByteLength('🙂')).toBe(4);
  });

  it('returns 0 for an empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});
