import { loadEnv } from './env-loader';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BOOTSTRAP_SECRET: 'bootstrap-secret',
  LIVEKIT_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecretdevsecret',
  INTERNAL_TOKEN: 'a'.repeat(32),
};

describe('loadEnv', () => {
  it('returns the validated env when all required vars are present', () => {
    const env = loadEnv(validEnv as unknown as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('throws a descriptive error when a required var is missing', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    void DATABASE_URL;
    expect(() => loadEnv(rest as unknown as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('accepts an optional REDIS_URL when present', () => {
    const env = loadEnv({ ...validEnv, REDIS_URL: 'redis://localhost:6379' } as unknown as NodeJS.ProcessEnv);
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('throws when a secret is too short', () => {
    expect(() =>
      loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' } as unknown as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('throws a descriptive error when LIVEKIT_URL is missing', () => {
    const { LIVEKIT_URL, ...rest } = validEnv;
    void LIVEKIT_URL;
    expect(() => loadEnv(rest as unknown as NodeJS.ProcessEnv)).toThrow(/LIVEKIT_URL/);
  });

  it('accepts an optional AGENT_NAME override', () => {
    const env = loadEnv({ ...validEnv, AGENT_NAME: 'custom-agent' } as unknown as NodeJS.ProcessEnv);
    expect(env.AGENT_NAME).toBe('custom-agent');
  });

  it('throws a descriptive error when INTERNAL_TOKEN is missing (Phase 4)', () => {
    const { INTERNAL_TOKEN, ...rest } = validEnv;
    void INTERNAL_TOKEN;
    expect(() => loadEnv(rest as unknown as NodeJS.ProcessEnv)).toThrow(/INTERNAL_TOKEN/);
  });
});
