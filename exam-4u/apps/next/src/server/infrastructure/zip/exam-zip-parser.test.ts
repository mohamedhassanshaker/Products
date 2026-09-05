import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { crc32 } from 'node:zlib';
import { parseExamZip } from './exam-zip-parser';
import { EmptyModuleError, InvalidQuestionFileError, InvalidZipStructureError } from './errors';

/** Builds a real ZIP archive (via `yazl`, the write-side counterpart to the production `yauzl` reader
 * used by `parseExamZip`) from a flat map of `entryName -> content`, entirely in memory — used for
 * every "normal" fixture (well-formed archives, structurally-invalid-but-not-malicious ones). `yazl`
 * itself validates entry names (rejects `..`/absolute paths at write time), which is *correct*
 * real-world zip-tool behavior but means it cannot be used to construct the zip-slip attack fixtures
 * below — {@link buildRawZip} exists for exactly that. Ported from
 * `legacy/api/src/infrastructure/zip/exam-zip-parser.spec.ts`. */
function buildZip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zipFile = new ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      if (name.endsWith('/')) {
        zipFile.addEmptyDirectory(name);
        continue;
      }
      zipFile.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), name);
    }
    const chunks: Buffer[] = [];
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zipFile.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    zipFile.outputStream.on('error', reject);
    zipFile.end();
  });
}

/** Hand-rolled, minimal ZIP (v2.0, STORE/no-compression) writer that performs **zero** validation of
 * entry names — deliberately, since `yazl` (the library `buildZip` above uses) already rejects
 * `../`/absolute-path entry names at write time. A real attacker does not need a well-behaved library
 * to craft a malicious archive — they can write the raw bytes directly, exactly as this function does,
 * so this is the only way to produce a genuine zip-slip fixture for `parseExamZip`'s security-critical
 * test coverage. Ported verbatim from legacy's identical test helper. */
function buildRawZip(entries: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

const validQuestion = (text = 'Q?', correct = 'A') =>
  JSON.stringify({ text, options: { A: 'a', B: 'b' }, correctAnswer: correct, explanation: 'exp' });

describe('parseExamZip (FR-AUTH-1)', () => {
  it('parses a well-formed archive into modules with their questions', async () => {
    const zip = await buildZip({
      'Algebra/q1.json': validQuestion('2+2?', 'A'),
      'Algebra/q2.json': validQuestion('3+3?', 'B'),
      'Geometry/q1.json': validQuestion('Angles?', 'A'),
    });

    const result = await parseExamZip(zip);

    expect(result.modules).toHaveLength(2);
    const algebra = result.modules.find((m) => m.moduleName === 'Algebra')!;
    expect(algebra.questions).toHaveLength(2);
    expect(algebra.questions[0].text).toBe('2+2?');
    expect(algebra.questions[0].options).toEqual({ A: 'a', B: 'b' });
    expect(algebra.questions[0].correctAnswer).toBe('A');
    expect(algebra.questions[0].explanation).toBe('exp');
  });

  it('treats a missing explanation as null (optional field)', async () => {
    const zip = await buildZip({
      'M1/q1.json': JSON.stringify({ text: 'Q', options: { A: 'a', B: 'b' }, correctAnswer: 'A' }),
    });
    const result = await parseExamZip(zip);
    expect(result.modules[0].questions[0].explanation).toBeNull();
  });

  it('ignores directory entries, __MACOSX junk, and .DS_Store', async () => {
    const zip = await buildZip({
      'Algebra/': '',
      '__MACOSX/Algebra/._q1.json': 'junk',
      'Algebra/.DS_Store': 'junk',
      'Algebra/q1.json': validQuestion(),
    });
    const result = await parseExamZip(zip);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].questions).toHaveLength(1);
  });

  it('rejects a non-ZIP buffer with INVALID_ZIP_STRUCTURE (magic-byte check)', async () => {
    await expect(parseExamZip(Buffer.from('not a zip'))).rejects.toBeInstanceOf(InvalidZipStructureError);
  });

  it('rejects an archive with no module folders at all', async () => {
    const zip = await buildZip({});
    await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
  });

  it('rejects a loose root-level file (not inside a module folder)', async () => {
    const zip = await buildZip({ 'readme.json': validQuestion() });
    await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
  });

  it('rejects a file nested three levels deep', async () => {
    const zip = await buildZip({ 'Algebra/sub/q1.json': validQuestion() });
    await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
  });

  it('rejects a non-.json file inside a module folder', async () => {
    const zip = await buildZip({ 'Algebra/q1.txt': 'not json' });
    await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
  });

  it('reports EMPTY_MODULE for a folder whose only entries are junk (no real questions)', async () => {
    const zip = await buildZip({ 'Algebra/': '', 'Algebra/.DS_Store': 'junk' });
    await expect(parseExamZip(zip)).rejects.toBeInstanceOf(EmptyModuleError);
  });

  describe('INVALID_QUESTION_FILE — one per required field', () => {
    it('rejects unparseable JSON, naming the file', async () => {
      const zip = await buildZip({ 'M1/q1.json': '{not json' });
      const err = await parseExamZip(zip).catch((e) => e);
      expect(err).toBeInstanceOf(InvalidQuestionFileError);
      expect((err as InvalidQuestionFileError).details).toEqual({ file: 'M1/q1.json', field: 'body' });
    });

    it('rejects a JSON array (not an object)', async () => {
      const zip = await buildZip({ 'M1/q1.json': '[]' });
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidQuestionFileError);
    });

    it('rejects a missing "text" field', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ options: { A: 'a', B: 'b' }, correctAnswer: 'A' }) });
      const err = await parseExamZip(zip).catch((e) => e);
      expect(err).toBeInstanceOf(InvalidQuestionFileError);
      expect((err as InvalidQuestionFileError).details).toEqual({ file: 'M1/q1.json', field: 'text' });
    });

    it('rejects an empty "text" field', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: '   ', options: { A: 'a', B: 'b' }, correctAnswer: 'A' }) });
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidQuestionFileError);
    });

    it('rejects "options" with fewer than two choices', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: 'Q', options: { A: 'a' }, correctAnswer: 'A' }) });
      const err = await parseExamZip(zip).catch((e) => e);
      expect(err).toBeInstanceOf(InvalidQuestionFileError);
      expect((err as InvalidQuestionFileError).details).toEqual({ file: 'M1/q1.json', field: 'options' });
    });

    it('rejects "options" that is not an object', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: 'Q', options: 'nope', correctAnswer: 'A' }) });
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidQuestionFileError);
    });

    it('rejects a non-string option value', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: 'Q', options: { A: 'a', B: 5 }, correctAnswer: 'A' }) });
      const err = await parseExamZip(zip).catch((e) => e);
      expect(err).toBeInstanceOf(InvalidQuestionFileError);
      expect((err as InvalidQuestionFileError).details).toEqual({ file: 'M1/q1.json', field: 'options.B' });
    });

    it('rejects a "correctAnswer" not naming one of the option keys', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: 'Q', options: { A: 'a', B: 'b' }, correctAnswer: 'Z' }) });
      const err = await parseExamZip(zip).catch((e) => e);
      expect(err).toBeInstanceOf(InvalidQuestionFileError);
      expect((err as InvalidQuestionFileError).details).toEqual({ file: 'M1/q1.json', field: 'correctAnswer' });
    });

    it('rejects a missing "correctAnswer"', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: 'Q', options: { A: 'a', B: 'b' } }) });
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidQuestionFileError);
    });

    it('rejects a non-string "explanation" when present', async () => {
      const zip = await buildZip({ 'M1/q1.json': JSON.stringify({ text: 'Q', options: { A: 'a', B: 'b' }, correctAnswer: 'A', explanation: 42 }) });
      const err = await parseExamZip(zip).catch((e) => e);
      expect(err).toBeInstanceOf(InvalidQuestionFileError);
      expect((err as InvalidQuestionFileError).details).toEqual({ file: 'M1/q1.json', field: 'explanation' });
    });
  });

  describe('zip-slip rejection (HLD §5.3, security-critical)', () => {
    const evil = Buffer.from('root:x:0:0:root:/root:/bin/bash');

    it('rejects a "../../../etc/passwd"-style path-traversal entry even though the rest of the archive is otherwise perfectly valid', async () => {
      const zip = buildRawZip([
        { name: 'Algebra/q1.json', data: Buffer.from(validQuestion()) },
        { name: '../../../etc/passwd', data: evil },
      ]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('rejects an absolute unix path entry', async () => {
      const zip = buildRawZip([{ name: '/etc/passwd', data: evil }]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('rejects a Windows absolute-drive path entry', async () => {
      const zip = buildRawZip([{ name: 'C:\\Windows\\System32\\evil.json', data: evil }]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('rejects a backslash-separated traversal entry (not just forward-slash)', async () => {
      const zip = buildRawZip([{ name: 'Algebra\\..\\..\\evil.json', data: evil }]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('rejects a traversal entry embedded mid-path (module/../../escape)', async () => {
      const zip = buildRawZip([{ name: 'Algebra/../../escape/evil.json', data: evil }]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('rejects a same-directory "./" segment (defense-in-depth, even though it cannot escape)', async () => {
      const zip = buildRawZip([{ name: 'Algebra/./q1.json', data: Buffer.from(validQuestion()) }]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('rejects an entry with an embedded NUL byte', async () => {
      const zip = buildRawZip([{ name: 'Algebra/q1.json\u0000.txt', data: Buffer.from(validQuestion()) }]);
      await expect(parseExamZip(zip)).rejects.toBeInstanceOf(InvalidZipStructureError);
    });

    it('the whole upload is rejected — a zip-slip entry does not get silently skipped while the rest is imported', async () => {
      const zip = buildRawZip([
        { name: 'Algebra/q1.json', data: Buffer.from(validQuestion()) },
        { name: 'Algebra/q2.json', data: Buffer.from(validQuestion()) },
        { name: '../evil.json', data: evil },
      ]);
      let caught: unknown;
      try {
        await parseExamZip(zip);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(InvalidZipStructureError);
    });
  });
});
