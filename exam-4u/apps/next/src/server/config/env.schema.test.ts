import { describe, expect, it } from 'vitest';
import { loadAndValidateEnv } from './env.schema';

/** Minimal valid env, used as a baseline every test mutates from. */
const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_USER: 'examland',
  DB_PASSWORD: 'examland_dev',
  DB_PLATFORM_SCHEMA: 'examland_platform',
};

describe('loadAndValidateEnv', () => {
  it('applies documented defaults when only the minimum is provided', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(3306);
    expect(env.DB_SYNCHRONIZE).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces DB_SYNCHRONIZE from the string "true" to a real boolean', () => {
    const env = loadAndValidateEnv({ ...VALID_ENV, DB_SYNCHRONIZE: 'true' });
    expect(env.DB_SYNCHRONIZE).toBe(true);
  });

  it('fails fast with a clear, enumerated message when a var has an invalid type/value', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, PORT: 'not-a-number-or-anything' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects an unknown NODE_ENV value', () => {
    // `NodeJS.ProcessEnv['NODE_ENV']` is typed as a fixed union by `@types/node`/Next's own global
    // augmentation — this test deliberately exercises the zod schema's *runtime* rejection of a
    // value outside that union (e.g. a genuinely malformed `.env` file), so the type system's own
    // narrowing has to be bypassed here on purpose, not worked around by accident.
    expect(() =>
      loadAndValidateEnv({ ...VALID_ENV, NODE_ENV: 'bogus' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment configuration/);
  });

  it('requires DB_HOST/DB_USER in production even though they are optional in development', () => {
    const { DB_HOST: _drop, ...withoutHost } = VALID_ENV;
    expect(() => loadAndValidateEnv({ ...withoutHost, NODE_ENV: 'production' })).toThrow(
      /DB_HOST is required in NODE_ENV=production/,
    );
  });

  it('allows DB_HOST/DB_USER to be absent in development (local-friendly default)', () => {
    const { DB_HOST: _drop, DB_USER: _drop2, ...rest } = VALID_ENV;
    expect(() => loadAndValidateEnv(rest)).not.toThrow();
  });

  it('refuses DB_SYNCHRONIZE=true in production, even though the zod shape alone would accept it', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' })).toThrow(
      /DB_SYNCHRONIZE must be false in NODE_ENV=production/,
    );
  });

  it('splits RESERVED_SUBDOMAINS into a trimmed string array', () => {
    const env = loadAndValidateEnv({ ...VALID_ENV, RESERVED_SUBDOMAINS: 'admin, www ,api' });
    expect(env.RESERVED_SUBDOMAINS).toEqual(['admin', 'www', 'api']);
  });

  it('applies the documented default reserved-subdomain list when unset', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.RESERVED_SUBDOMAINS).toEqual(['admin', 'www', 'api', 'app', 'auth', 'static', 'mail', 'status']);
  });

  it('defaults FALLBACK_PACKAGE_KEY to "starter"', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.FALLBACK_PACKAGE_KEY).toBe('starter');
  });

  it('rejects JWT_TENANT_SECRET === JWT_PLATFORM_SECRET whenever both are set, in every environment', () => {
    expect(() =>
      loadAndValidateEnv({ ...VALID_ENV, JWT_TENANT_SECRET: 'same-secret', JWT_PLATFORM_SECRET: 'same-secret' }),
    ).toThrow(/JWT_TENANT_SECRET and JWT_PLATFORM_SECRET must differ/);
  });

  it('allows JWT_TENANT_SECRET/JWT_PLATFORM_SECRET to differ', () => {
    expect(() =>
      loadAndValidateEnv({ ...VALID_ENV, JWT_TENANT_SECRET: 'tenant-secret', JWT_PLATFORM_SECRET: 'platform-secret' }),
    ).not.toThrow();
  });

  it('requires JWT_TENANT_SECRET/JWT_PLATFORM_SECRET in production', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, NODE_ENV: 'production' })).toThrow(
      /JWT_TENANT_SECRET is required in NODE_ENV=production/,
    );
  });

  it('applies documented auth defaults (TTLs/bcrypt cost/password policy) when unset', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.JWT_TENANT_TTL).toBe('60m');
    expect(env.JWT_PLATFORM_TTL).toBe('60m');
    expect(env.BCRYPT_COST).toBe(12);
    expect(env.PASSWORD_MIN_LENGTH).toBe(8);
    expect(env.PASSWORD_REQUIRE_UPPER).toBe(true);
    expect(env.PASSWORD_REQUIRE_SYMBOL).toBe(false);
    expect(env.RESET_TOKEN_TTL_MIN).toBe(60);
    expect(env.DEFAULT_TENANT_SUBDOMAIN).toBe('default');
    expect(env.TENANT_CACHE_TTL_MS).toBe(60_000);
    expect(env.TENANT_CACHE_NEG_TTL_MS).toBe(15_000);
    expect(env.GOOGLE_CLIENT_ID).toBe('');
  });

  it('applies documented storage/file-signing/worker defaults when unset', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.STORAGE_ROOT).toBe('/app/storage');
    expect(env.SIGNED_URL_TTL_SEC).toBe(900);
    expect(env.MAX_AVATAR_SIZE_BYTES).toBe(5_242_880);
    expect(env.WORKER_OUTBOX_TICK_MS).toBe(10_000);
  });

  it('requires FILE_SIGNING_SECRET in production', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, NODE_ENV: 'production', JWT_TENANT_SECRET: 'a', JWT_PLATFORM_SECRET: 'b' })).toThrow(
      /FILE_SIGNING_SECRET is required in NODE_ENV=production/,
    );
  });

  it('reports every violation at once, not just the first', () => {
    const { DB_HOST: _drop, DB_USER: _drop2, ...rest } = VALID_ENV;
    try {
      loadAndValidateEnv({ ...rest, NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' });
      expect.fail('expected loadAndValidateEnv to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('DB_HOST is required');
      expect(message).toContain('DB_USER is required');
      expect(message).toContain('DB_SYNCHRONIZE must be false');
    }
  });

  // Phase 2 sub-slice "2c" (FR-PKG-6) — Stripe billing config.
  it('defaults every STRIPE_* var to an empty string (billing disabled by default)', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.STRIPE_SECRET_KEY).toBe('');
    expect(env.STRIPE_WEBHOOK_SECRET).toBe('');
    expect(env.STRIPE_CHECKOUT_SUCCESS_URL).toBe('');
    expect(env.STRIPE_CHECKOUT_CANCEL_URL).toBe('');
  });

  it('allows both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to be empty (billing disabled is a valid deployment shape)', () => {
    expect(() => loadAndValidateEnv(VALID_ENV)).not.toThrow();
  });

  it('allows both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to be set together', () => {
    expect(() =>
      loadAndValidateEnv({ ...VALID_ENV, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
    ).not.toThrow();
  });

  it('rejects STRIPE_SECRET_KEY set without STRIPE_WEBHOOK_SECRET', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(
      /STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both be set or both be empty/,
    );
  });

  it('rejects STRIPE_WEBHOOK_SECRET set without STRIPE_SECRET_KEY', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(
      /STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both be set or both be empty/,
    );
  });

  // ── Phase 5: AI/vector/embeddings ────────────────────────────────────────────────────────────
  it('defaults AI_ENABLED to false (the "AI-less deployment" replacement is opt-in, not opt-out)', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.AI_ENABLED).toBe(false);
  });

  it('coerces AI_ENABLED from the string "true" to a real boolean', () => {
    expect(loadAndValidateEnv({ ...VALID_ENV, AI_ENABLED: 'true' }).AI_ENABLED).toBe(true);
  });

  it('defaults EMBEDDINGS_PROVIDER to "null" (dev-friendly, no external credential needed by default)', () => {
    expect(loadAndValidateEnv(VALID_ENV).EMBEDDINGS_PROVIDER).toBe('null');
  });

  it('refuses EMBEDDINGS_PROVIDER=null in production, even though the zod shape alone would accept it', () => {
    expect(() => loadAndValidateEnv({ ...VALID_ENV, NODE_ENV: 'production', EMBEDDINGS_PROVIDER: 'null' })).toThrow(
      /EMBEDDINGS_PROVIDER=null \(NullEmbeddingsAdapter\) is refused in NODE_ENV=production\/staging/,
    );
  });

  it('allows EMBEDDINGS_PROVIDER=openai-compatible in production', () => {
    expect(() =>
      loadAndValidateEnv({
        ...VALID_ENV,
        NODE_ENV: 'production',
        JWT_TENANT_SECRET: 'tenant-secret',
        JWT_PLATFORM_SECRET: 'platform-secret',
        FILE_SIGNING_SECRET: 'a-file-signing-secret',
        EMBEDDINGS_PROVIDER: 'openai-compatible',
      }),
    ).not.toThrow();
  });

  it('defaults VECTOR_COLLECTION_PREFIX to "examland_next" — deliberately distinct from legacy\'s "examland" default (tenant/collection isolation)', () => {
    expect(loadAndValidateEnv(VALID_ENV).VECTOR_COLLECTION_PREFIX).toBe('examland_next');
  });

  it('defaults EMBEDDING_DIMS to 1536 and QDRANT_URL to the local dev Qdrant', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.EMBEDDING_DIMS).toBe(1536);
    expect(env.QDRANT_URL).toBe('http://localhost:6333');
  });

  it('defaults every RETRIEVAL_* hybrid-search tuning var to its documented value', () => {
    const env = loadAndValidateEnv(VALID_ENV);
    expect(env.RETRIEVAL_TOPK_LESSON).toBe(5);
    expect(env.RETRIEVAL_TOPK_EXTRACTION).toBe(12);
    expect(env.RETRIEVAL_TOPK_PROMPT).toBe(12);
    expect(env.RETRIEVAL_RELEVANCE_FLOOR).toBe(0.15);
    expect(env.RETRIEVAL_HYBRID_LEXICAL_WEIGHT).toBe(0.35);
    expect(env.RETRIEVAL_HYBRID_CANDIDATE_MULTIPLIER).toBe(4);
    expect(env.RETRIEVAL_HYBRID_LEXICAL_SCAN_LIMIT).toBe(200);
  });
});
