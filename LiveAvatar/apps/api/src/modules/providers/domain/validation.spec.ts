import { assertEndpointUrl, assertNoSecretInExtra } from './validation';

describe('assertEndpointUrl', () => {
  it('accepts an https URL', () => {
    expect(assertEndpointUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it('accepts http://localhost for lab use', () => {
    expect(assertEndpointUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('accepts http://127.0.0.1 for lab use', () => {
    expect(assertEndpointUrl('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
  });

  it('rejects a non-loopback http URL', () => {
    expect(() => assertEndpointUrl('http://api.example.com')).toThrow(
      expect.objectContaining({ code: 'PROVIDER_ENDPOINT_INVALID' }),
    );
  });

  it('rejects an unparseable URL', () => {
    expect(() => assertEndpointUrl('not-a-url')).toThrow(
      expect.objectContaining({ code: 'PROVIDER_ENDPOINT_INVALID' }),
    );
  });
});

describe('assertNoSecretInExtra', () => {
  it('accepts an empty/undefined extra blob', () => {
    expect(assertNoSecretInExtra(undefined)).toEqual({});
    expect(assertNoSecretInExtra({})).toEqual({});
  });

  it('accepts non-secret knobs', () => {
    expect(assertNoSecretInExtra({ region: 'us-east-1', timeout_ms: 5000 })).toEqual({
      region: 'us-east-1',
      timeout_ms: 5000,
    });
  });

  it.each(['api_key', 'apiKey', 'token', 'password', 'secret', 'API_KEY'])(
    'rejects a top-level %s key',
    (key) => {
      expect(() => assertNoSecretInExtra({ [key]: 'shh' })).toThrow(
        expect.objectContaining({ code: 'PROVIDER_SECRET_IN_BODY' }),
      );
    },
  );

  it('rejects a nested secret key', () => {
    expect(() => assertNoSecretInExtra({ nested: { deeper: { token: 'shh' } } })).toThrow(
      expect.objectContaining({ code: 'PROVIDER_SECRET_IN_BODY' }),
    );
  });

  it('rejects a secret key inside an array', () => {
    expect(() => assertNoSecretInExtra({ list: [{ secret: 'shh' }] })).toThrow(
      expect.objectContaining({ code: 'PROVIDER_SECRET_IN_BODY' }),
    );
  });

  it('rejects a blob larger than 8 KB', () => {
    const big = { blob: 'x'.repeat(9000) };
    expect(() => assertNoSecretInExtra(big)).toThrow(
      expect.objectContaining({ code: 'PROVIDER_SECRET_IN_BODY' }),
    );
  });
});
