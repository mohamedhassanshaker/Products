import { cleanText, parseContent } from './parse-content';

describe('parseContent', () => {
  it('decodes plain_text as utf-8', () => {
    expect(parseContent(Buffer.from('hello world', 'utf-8'), 'plain_text')).toBe('hello world');
  });

  it('decodes markdown as utf-8 (no markdown-specific transform)', () => {
    expect(parseContent(Buffer.from('# Heading\n\nBody', 'utf-8'), 'markdown')).toBe('# Heading\n\nBody');
  });

  it('preserves non-ASCII characters', () => {
    expect(parseContent(Buffer.from('café — naïve', 'utf-8'), 'plain_text')).toBe('café — naïve');
  });

  it('throws KNOWLEDGE_PARSER_NOT_SUPPORTED for pdf (unreachable via the validated path; defensive)', () => {
    expect(() => parseContent(Buffer.from('%PDF-1.4'), 'pdf')).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_PARSER_NOT_SUPPORTED' }),
    );
  });
});

describe('cleanText', () => {
  it('normalizes CRLF to LF', () => {
    expect(cleanText('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3');
  });

  it('normalizes bare CR to LF', () => {
    expect(cleanText('line1\rline2')).toBe('line1\nline2');
  });

  it('leaves a single blank line untouched', () => {
    expect(cleanText('a\n\nb')).toBe('a\n\nb');
  });

  it('leaves two consecutive blank lines untouched', () => {
    expect(cleanText('a\n\n\nb')).toBe('a\n\n\nb');
  });

  it('collapses three or more consecutive blank lines to exactly one', () => {
    expect(cleanText('a\n\n\n\nb')).toBe('a\n\nb');
    expect(cleanText('a\n\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims leading and trailing whitespace', () => {
    expect(cleanText('  \n\n hello \n\n  ')).toBe('hello');
  });
});
