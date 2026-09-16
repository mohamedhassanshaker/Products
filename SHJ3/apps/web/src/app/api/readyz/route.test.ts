import { afterEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "../../../modules/platform/config.js";
import { GET } from "./route.js";

/**
 * Real test of the readiness route, exercising the actual `loadConfig()`
 * path (not mocked) — mirrors `modules/platform/config.test.ts`'s own
 * env-driven style, since readiness here IS config validation, per
 * `route.ts`'s own doc comment.
 */

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

const ORIGINAL_ENV: Record<string, string | undefined> = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  const merged = { ...COMPLETE, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  resetConfigForTesting();
});

describe("GET /api/readyz", () => {
  it("reports ready (200) once the process's own config validates", () => {
    setEnv({});

    const response = GET();

    expect(response.status).toBe(200);
  });

  it("reports ready and includes an ok body", async () => {
    setEnv({});

    const response = GET();
    const body = await response.json();

    expect(body).toEqual({ status: "ok" });
  });

  it("reports not ready (503) when a required variable is missing", () => {
    setEnv({ SHJ3_SQL_URL: undefined });

    const response = GET();

    expect(response.status).toBe(503);
  });

  it("names the missing variable without leaking any secret value", async () => {
    setEnv({ SHJ3_SQL_URL: undefined, SHJ3_SESSION_SECRET: "a-real-looking-secret-value" });

    const response = GET();
    const body = await response.json();

    expect(body.status).toBe("not_ready");
    expect(body.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("SHJ3_SQL_URL")]),
    );
    // ConfigurationError's own contract: names, never values. Proven here,
    // not just assumed from config.ts's doc comment.
    expect(JSON.stringify(body)).not.toContain("a-real-looking-secret-value");
  });

  it("reports not ready when the mock verification adapter is paired with production", () => {
    // ADR-0006 rule 6, exercised through the readiness route rather than
    // only through validateConfig() directly — this is the path a real
    // misconfigured deployment would actually be caught by.
    setEnv({
      SHJ3_ENVIRONMENT: "production",
      SHJ3_VERIFICATION_ADAPTER: "mock",
      SHJ3_SESSION_SECRET: "a".repeat(48),
    });

    const response = GET();

    expect(response.status).toBe(503);
  });
});
