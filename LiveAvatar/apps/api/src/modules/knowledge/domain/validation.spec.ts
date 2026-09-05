import {
  assertChunkOverlapValid,
  assertChunkingStrategySupported,
  assertEmbeddingModelSupported,
  assertParserSupported,
  assertSourceName,
  assertUploadFile,
  type UploadedFile,
} from './validation';

function makeFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    buffer: Buffer.from('hello'),
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    size: 5,
    ...overrides,
  };
}

describe('assertSourceName', () => {
  it('trims and accepts a valid name', () => {
    expect(assertSourceName('  Docs  ')).toBe('Docs');
  });

  it('rejects an empty/whitespace-only name', () => {
    expect(() => assertSourceName('   ')).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_NAME_REQUIRED' }));
  });

  it('rejects a name over 160 characters', () => {
    expect(() => assertSourceName('a'.repeat(161))).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_NAME_REQUIRED' }),
    );
  });
});

describe('assertParserSupported', () => {
  it.each(['plain_text', 'markdown'] as const)('accepts %s', (parser) => {
    expect(() => assertParserSupported(parser)).not.toThrow();
  });

  it('rejects pdf (real enum value, not implemented this phase)', () => {
    expect(() => assertParserSupported('pdf')).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_PARSER_NOT_SUPPORTED' }),
    );
  });
});

describe('assertChunkingStrategySupported', () => {
  it('accepts fixed', () => {
    expect(() => assertChunkingStrategySupported('fixed')).not.toThrow();
  });

  it.each(['semantic', 'heading_aware'] as const)('rejects %s (BL-071, not implemented this phase)', (strategy) => {
    expect(() => assertChunkingStrategySupported(strategy)).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED' }),
    );
  });
});

describe('assertEmbeddingModelSupported', () => {
  it('accepts text-embedding-3-small', () => {
    expect(() => assertEmbeddingModelSupported('text-embedding-3-small')).not.toThrow();
  });

  it('rejects any other model', () => {
    expect(() => assertEmbeddingModelSupported('text-embedding-3-large')).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_EMBEDDING_MODEL_NOT_SUPPORTED' }),
    );
  });
});

describe('assertChunkOverlapValid', () => {
  it('accepts overlap 0 with a positive chunk size', () => {
    expect(() => assertChunkOverlapValid(800, 0)).not.toThrow();
  });

  it('accepts overlap strictly less than chunk size', () => {
    expect(() => assertChunkOverlapValid(800, 100)).not.toThrow();
  });

  it('rejects a negative overlap', () => {
    expect(() => assertChunkOverlapValid(800, -1)).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID' }),
    );
  });

  it('rejects overlap equal to chunk size', () => {
    expect(() => assertChunkOverlapValid(800, 800)).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID' }),
    );
  });

  it('rejects overlap greater than chunk size', () => {
    expect(() => assertChunkOverlapValid(800, 900)).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID' }),
    );
  });
});

describe('assertUploadFile', () => {
  it('rejects a missing file', () => {
    expect(() => assertUploadFile(undefined)).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_FILE_MISSING' }),
    );
  });

  it('accepts a plain-text file under the size cap', () => {
    expect(assertUploadFile(makeFile())).toEqual(makeFile());
  });

  it('accepts a .md file even with an inconsistent mimetype (extension fallback)', () => {
    expect(() =>
      assertUploadFile(makeFile({ originalname: 'notes.MD', mimetype: 'application/octet-stream' })),
    ).not.toThrow();
  });

  it('accepts text/markdown and text/x-markdown mimetypes', () => {
    expect(() => assertUploadFile(makeFile({ mimetype: 'text/markdown', originalname: 'x' }))).not.toThrow();
    expect(() => assertUploadFile(makeFile({ mimetype: 'text/x-markdown', originalname: 'x' }))).not.toThrow();
  });

  it('rejects a file over the 10 MiB cap', () => {
    expect(() => assertUploadFile(makeFile({ size: 10 * 1024 * 1024 + 1 }))).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_FILE_TOO_LARGE' }),
    );
  });

  it('rejects an unsupported file type (e.g. an .exe with an octet-stream mimetype)', () => {
    expect(() =>
      assertUploadFile(makeFile({ originalname: 'payload.exe', mimetype: 'application/octet-stream' })),
    ).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED' }));
  });
});
