import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  ENVIRONMENTS,
  PAYMENT_GATEWAY_ADAPTERS,
  VERIFICATION_ADAPTERS,
  validateConfig,
} from "./config.js";

/**
 * Boot-time configuration validation.
 *
 * The production-mock refusal (ADR-0006 rule 6) is the reason this module exists,
 * and the reason `validateConfig` takes its environment as an argument: a guard
 * that could only be demonstrated by attempting a production deployment is a
 * guard nobody can confirm still works.
 *
 * Covers ADR-0006 rule 6, RISK-004 and NFR-SEC-01.
 */

/** A real 32-byte key, base64-encoded — test-only, distinct from the checked-out `.env.example` placeholder. */
const VALID_TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const COMPLETE = {
  SHJ3_ENVIRONMENT: "development",
  SHJ3_SQL_URL: "sqlserver://localhost:1433;database=shj3",
  SHJ3_REDIS_URL: "redis://localhost:6379",
  SHJ3_SESSION_SECRET: "local-dev-session-secret-not-for-production",
  SHJ3_SESSION_TTL_SECONDS: "28800",
  SHJ3_VERIFICATION_ADAPTER: "mock",
  SHJ3_PAYMENT_GATEWAY_ADAPTER: "mock",
  SHJ3_ENCRYPTION_KEY: VALID_TEST_ENCRYPTION_KEY,
} as const;

function env(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...COMPLETE, ...overrides };
}

describe("the mock verification adapter cannot boot in production", () => {
  it("refuses to start", () => {
    // ADR-0006 rule 6. MockVerificationProvider grants any assurance level on
    // request, so in front of the payment endpoints it is an unauthenticated
    // payment path — the worst failure this system could have.
    expect(() =>
      validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "mock",
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("says why, and cites the rule", () => {
    // An operator seeing this at deploy time needs to know it is deliberate, or
    // the next step is to look for the flag that turns it off.
    try {
      validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "mock",
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      );
      expect.unreachable("production + mock must not validate");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const { problems } = error as ConfigurationError;
      expect(problems.join("\n")).toMatch(/ADR-0006 rule 6/);
      expect(problems.join("\n")).toMatch(/payment/i);
    }
  });

  it("allows the mock everywhere else, because B11 is untestable without it", () => {
    for (const environment of ENVIRONMENTS.filter((e) => e !== "production")) {
      const secret = environment === "staging" ? "a".repeat(48) : COMPLETE.SHJ3_SESSION_SECRET;
      const config = validateConfig(
        env({
          SHJ3_ENVIRONMENT: environment,
          SHJ3_VERIFICATION_ADAPTER: "mock",
          SHJ3_SESSION_SECRET: secret,
        }),
      );
      expect(config.verificationAdapter).toBe("mock");
    }
  });

  it("permits production with a real adapter", () => {
    for (const adapter of VERIFICATION_ADAPTERS.filter((a) => a !== "mock")) {
      const config = validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: adapter,
          // B-8's own, separate production guard trips on `COMPLETE`'s default
          // `"mock"` payment-gateway adapter otherwise — this test is about
          // the verification guard specifically.
          SHJ3_PAYMENT_GATEWAY_ADAPTER: "sharjahpay",
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      );
      expect(config.environment).toBe("production");
      expect(config.verificationAdapter).toBe(adapter);
    }
  });

  it("fails a production boot that misspells the adapter, rather than falling back", () => {
    // A plausible-looking fallback is how a typo becomes a mocked payment path.
    expect(() =>
      validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "uae-pass",
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      ),
    ).toThrow(ConfigurationError);
  });
});

describe("the mock payment gateway cannot boot in production", () => {
  // B-8's payments analogue of ADR-0006 rule 6, mirrored test-for-test against
  // the identical verification-adapter guard above.
  it("refuses to start", () => {
    expect(() =>
      validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "uaepass",
          SHJ3_PAYMENT_GATEWAY_ADAPTER: "mock",
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("says why", () => {
    try {
      validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "uaepass",
          SHJ3_PAYMENT_GATEWAY_ADAPTER: "mock",
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      );
      expect.unreachable("production + mock payment gateway must not validate");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const { problems } = error as ConfigurationError;
      expect(problems.join("\n")).toMatch(/MockPaymentGateway/);
      expect(problems.join("\n")).toMatch(/production/i);
    }
  });

  it("allows the mock everywhere else", () => {
    for (const environment of ENVIRONMENTS.filter((e) => e !== "production")) {
      const secret = environment === "staging" ? "a".repeat(48) : COMPLETE.SHJ3_SESSION_SECRET;
      const config = validateConfig(
        env({
          SHJ3_ENVIRONMENT: environment,
          SHJ3_PAYMENT_GATEWAY_ADAPTER: "mock",
          SHJ3_SESSION_SECRET: secret,
        }),
      );
      expect(config.paymentGatewayAdapter).toBe("mock");
    }
  });

  it("permits production with a real adapter", () => {
    for (const adapter of PAYMENT_GATEWAY_ADAPTERS.filter((a) => a !== "mock")) {
      const config = validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "uaepass",
          SHJ3_PAYMENT_GATEWAY_ADAPTER: adapter,
          SHJ3_SESSION_SECRET: "a".repeat(48),
        }),
      );
      expect(config.paymentGatewayAdapter).toBe(adapter);
    }
  });
});

describe("required secrets", () => {
  it.each(["SHJ3_SQL_URL", "SHJ3_REDIS_URL", "SHJ3_SESSION_SECRET", "SHJ3_ENCRYPTION_KEY"])(
    "refuses to start without %s",
    (name) => {
      expect(() => validateConfig(env({ [name]: undefined }))).toThrow(new RegExp(name));
    },
  );

  it("treats whitespace as missing", () => {
    expect(() => validateConfig(env({ SHJ3_REDIS_URL: "   " }))).toThrow(/SHJ3_REDIS_URL/);
  });

  it("reports every problem at once rather than one per restart", () => {
    // Exhaustive, like api.md §12 invariant 8's stance on request validation.
    try {
      validateConfig({});
      expect.unreachable("an empty environment must not validate");
    } catch (error) {
      const { problems } = error as ConfigurationError;
      expect(problems.length).toBeGreaterThanOrEqual(5);
      expect(problems.some((p) => p.includes("SHJ3_SQL_URL"))).toBe(true);
      expect(problems.some((p) => p.includes("SHJ3_REDIS_URL"))).toBe(true);
      expect(problems.some((p) => p.includes("SHJ3_SESSION_SECRET"))).toBe(true);
      expect(problems.some((p) => p.includes("SHJ3_ENVIRONMENT"))).toBe(true);
    }
  });

  it("never prints a secret value it is complaining about", () => {
    // This error reaches logs, and a validator that echoes the secret has leaked
    // it to everywhere logs go.
    const secret = "super-secret-value-that-must-not-be-logged";
    try {
      validateConfig(env({ SHJ3_ENVIRONMENT: "production", SHJ3_SESSION_SECRET: secret }));
      expect.unreachable("production + mock must not validate");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe("the environment itself", () => {
  it("refuses an unset environment rather than defaulting to development", () => {
    // Defaulting would make a production deployment that forgot the variable the
    // most permissive configuration there is — including allowing the mock.
    expect(() => validateConfig(env({ SHJ3_ENVIRONMENT: undefined }))).toThrow(/SHJ3_ENVIRONMENT/);
  });

  it("refuses an unrecognised environment", () => {
    expect(() => validateConfig(env({ SHJ3_ENVIRONMENT: "prod" }))).toThrow(/SHJ3_ENVIRONMENT/);
  });
});

describe("deployed-environment session secret", () => {
  it("rejects the .env.example placeholder in staging and production", () => {
    // The realistic accident is not a weak choice — it is .env.example being
    // copied and the one line that matters going unedited.
    for (const environment of ["staging", "production"]) {
      expect(() =>
        validateConfig(
          env({
            SHJ3_ENVIRONMENT: environment,
            SHJ3_VERIFICATION_ADAPTER: "uaepass",
            SHJ3_SESSION_SECRET: "local-dev-session-secret-not-for-production",
          }),
        ),
      ).toThrow(/placeholder/);
    }
  });

  it("rejects a short secret in a deployed environment", () => {
    expect(() =>
      validateConfig(
        env({
          SHJ3_ENVIRONMENT: "production",
          SHJ3_VERIFICATION_ADAPTER: "uaepass",
          SHJ3_SESSION_SECRET: "short",
        }),
      ),
    ).toThrow(/at least/);
  });

  it("leaves a developer's machine alone", () => {
    expect(validateConfig(env({})).sessionSecret).toBe(COMPLETE.SHJ3_SESSION_SECRET);
  });
});

describe("encryption key (B-2 — envelope-encrypts StaffCredentials.totpSecretCipher)", () => {
  it("rejects a value that is not base64 for a 32-byte key, in every environment", () => {
    // Unlike the session secret's length floor, this is not a "stronger in a deployed
    // environment" policy — AES-256 structurally requires exactly 32 key bytes, so a
    // wrong-length value must fail in development too, not just staging/production.
    expect(() => validateConfig(env({ SHJ3_ENCRYPTION_KEY: "too-short" }))).toThrow(/32 bytes/);
  });

  it("rejects the .env.example placeholder in staging and production", () => {
    for (const environment of ["staging", "production"]) {
      expect(() =>
        validateConfig(
          env({
            SHJ3_ENVIRONMENT: environment,
            SHJ3_VERIFICATION_ADAPTER: "uaepass",
            SHJ3_ENCRYPTION_KEY: "+yddTmNwlSyCtqzv2bABbnYmDiwu9hojxvkrJ73e4U8=",
          }),
        ),
      ).toThrow(/placeholder/);
    }
  });

  it("accepts a real 32-byte key and leaves a developer's machine alone", () => {
    expect(validateConfig(env({})).encryptionKey).toBe(VALID_TEST_ENCRYPTION_KEY);
  });
});

describe("session TTL", () => {
  it("defaults when unset", () => {
    expect(validateConfig(env({ SHJ3_SESSION_TTL_SECONDS: undefined })).sessionTtlSeconds).toBe(
      28_800,
    );
  });

  it("rejects a non-integer or non-positive value", () => {
    for (const value of ["0", "-1", "1.5", "eight hours"]) {
      expect(() => validateConfig(env({ SHJ3_SESSION_TTL_SECONDS: value }))).toThrow(
        /SHJ3_SESSION_TTL_SECONDS/,
      );
    }
  });
});
