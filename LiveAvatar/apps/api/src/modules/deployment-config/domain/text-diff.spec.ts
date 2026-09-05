import { diffLines } from './text-diff';

describe('diffLines', () => {
  it('marks every line equal for identical texts', () => {
    const text = 'a\nb\nc';
    expect(diffLines(text, text)).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('a pure addition appends add-only lines after the shared prefix', () => {
    const before = 'a\nb';
    const after = 'a\nb\nc\nd';
    expect(diffLines(before, after)).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'add', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
  });

  it('a pure removal produces remove-only lines for the trailing gap', () => {
    const before = 'a\nb\nc\nd';
    const after = 'a\nb';
    expect(diffLines(before, after)).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'remove', text: 'c' },
      { op: 'remove', text: 'd' },
    ]);
  });

  it('a middle-line replacement produces a remove followed by an add around unchanged context', () => {
    const before = 'version: 1\nllm: openai\ntts: fish-speech';
    const after = 'version: 1\nllm: anthropic\ntts: fish-speech';
    expect(diffLines(before, after)).toEqual([
      { op: 'equal', text: 'version: 1' },
      { op: 'remove', text: 'llm: openai' },
      { op: 'add', text: 'llm: anthropic' },
      { op: 'equal', text: 'tts: fish-speech' },
    ]);
  });

  it('mixed insertions and deletions interleaved with unchanged lines', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nx\nc\ny\ne';
    const result = diffLines(before, after);
    // Reconstructing "after" from equal+add ops must reproduce the after text exactly.
    const reconstructedAfter = result.filter((l) => l.op !== 'remove').map((l) => l.text);
    expect(reconstructedAfter).toEqual(after.split('\n'));
    // Reconstructing "before" from equal+remove ops must reproduce the before text exactly.
    const reconstructedBefore = result.filter((l) => l.op !== 'add').map((l) => l.text);
    expect(reconstructedBefore).toEqual(before.split('\n'));
  });

  it('both empty strings produce a single equal empty line (split("\\n") of "" is [""])', () => {
    expect(diffLines('', '')).toEqual([{ op: 'equal', text: '' }]);
  });

  it('before empty, after non-empty (the single empty-string "before" line has no match, so it is removed before the real content is added)', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { op: 'remove', text: '' },
      { op: 'add', text: 'a' },
      { op: 'add', text: 'b' },
    ]);
  });

  it('before non-empty, after empty is a pure removal', () => {
    expect(diffLines('a\nb', '')).toEqual([
      { op: 'remove', text: 'a' },
      { op: 'remove', text: 'b' },
      { op: 'add', text: '' },
    ]);
  });

  it('is order-sensitive: reversing before/after swaps add and remove ops', () => {
    const before = 'a\nb';
    const after = 'a\nb\nc';
    const forward = diffLines(before, after);
    const backward = diffLines(after, before);
    expect(forward).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'add', text: 'c' },
    ]);
    expect(backward).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
      { op: 'remove', text: 'c' },
    ]);
  });
});
