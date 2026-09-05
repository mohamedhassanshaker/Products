import { assertToolName, assertToolUrl, assertCredentialPresence, deriveApiRef } from './validation';

describe('assertToolName', () => {
  it('accepts a normal name and trims it', () => {
    expect(assertToolName('  Lookup order  ')).toBe('Lookup order');
  });

  it('rejects an empty name', () => {
    expect(() => assertToolName('   ')).toThrow(expect.objectContaining({ code: 'TOOL_NAME_REQUIRED' }));
  });

  it('rejects a name over 80 characters', () => {
    expect(() => assertToolName('x'.repeat(81))).toThrow(
      expect.objectContaining({ code: 'TOOL_NAME_REQUIRED' }),
    );
  });
});

describe('assertToolUrl', () => {
  it('accepts a plain https URL', () => {
    expect(assertToolUrl('https://api.example.com/v1/orders')).toBe('https://api.example.com/v1/orders');
  });

  it('rejects a non-https URL', () => {
    expect(() => assertToolUrl('http://api.example.com')).toThrow(
      expect.objectContaining({ code: 'TOOL_URL_INVALID' }),
    );
  });

  it('rejects an unparseable URL', () => {
    expect(() => assertToolUrl('not-a-url')).toThrow(expect.objectContaining({ code: 'TOOL_URL_INVALID' }));
  });

  it.each([
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.1.1/x',
    'https://svc.internal/x',
    'https://box.local/x',
  ])('rejects an SSRF-shaped internal host %s', (url) => {
    expect(() => assertToolUrl(url)).toThrow(expect.objectContaining({ code: 'TOOL_URL_INVALID' }));
  });

  it('accepts a normal-looking public 172.x host outside the private range', () => {
    expect(assertToolUrl('https://172.64.0.1/x')).toBe('https://172.64.0.1/x');
  });
});

describe('assertCredentialPresence', () => {
  it('is a no-op when the tool does not require a credential', () => {
    expect(() => assertCredentialPresence(false, null)).not.toThrow();
  });

  it('is a no-op when required and present', () => {
    expect(() => assertCredentialPresence(true, 'secrets/weather')).not.toThrow();
  });

  it('throws TOOL_CREDENTIAL_MISSING when required and absent', () => {
    expect(() => assertCredentialPresence(true, null)).toThrow(
      expect.objectContaining({ code: 'TOOL_CREDENTIAL_MISSING' }),
    );
  });
});

describe('deriveApiRef', () => {
  it('slugifies a name', () => {
    expect(deriveApiRef('Lookup Order!')).toBe('lookup_order');
  });

  it('falls back to "tool" for a name with no alphanumerics', () => {
    expect(deriveApiRef('!!!')).toBe('tool');
  });

  it('truncates to 64 characters', () => {
    expect(deriveApiRef('a'.repeat(100)).length).toBe(64);
  });
});
