import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetDbEnvCacheForTests, loadDbEnv } from "./config.js";

const ENV_KEYS = [
  "NEXTBOT_DB_ENV",
  "NEXTBOT_DB_OWNER_URL",
  "NEXTBOT_DB_APP_URL",
  "NEXTBOT_DB_PLATFORM_URL",
  "NEXTBOT_DB_GATEWAY_URL",
  "NEXTBOT_DB_OWNER_TEST_URL",
  "NEXTBOT_DB_APP_TEST_URL",
  "NEXTBOT_DB_PLATFORM_TEST_URL",
  "NEXTBOT_DB_GATEWAY_TEST_URL",
] as const;

describe("loadDbEnv", () => {
  const originalValues: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) originalValues[key] = process.env[key];
    _resetDbEnvCacheForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalValues[key] === undefined) delete process.env[key];
      else process.env[key] = originalValues[key];
    }
    _resetDbEnvCacheForTests();
  });

  it("throws with a descriptive message when required vars are missing", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(() => loadDbEnv()).toThrow(/invalid\/missing database configuration/);
  });

  it("reads the *_TEST_URL variants when NEXTBOT_DB_ENV=test", () => {
    process.env.NEXTBOT_DB_ENV = "test";
    process.env.NEXTBOT_DB_OWNER_TEST_URL = "postgres://owner@localhost/db";
    process.env.NEXTBOT_DB_APP_TEST_URL = "postgres://app@localhost/db";
    process.env.NEXTBOT_DB_PLATFORM_TEST_URL = "postgres://platform@localhost/db";
    process.env.NEXTBOT_DB_GATEWAY_TEST_URL = "postgres://gateway@localhost/db";

    const env = loadDbEnv();
    expect(env.NEXTBOT_DB_OWNER_URL).toBe("postgres://owner@localhost/db");
    expect(env.NEXTBOT_DB_APP_URL).toBe("postgres://app@localhost/db");
    expect(env.NEXTBOT_DB_PLATFORM_URL).toBe("postgres://platform@localhost/db");
    expect(env.NEXTBOT_DB_GATEWAY_URL).toBe("postgres://gateway@localhost/db");
  });

  it("caches the result across calls until reset", () => {
    process.env.NEXTBOT_DB_ENV = "test";
    process.env.NEXTBOT_DB_OWNER_TEST_URL = "postgres://owner@localhost/db";
    process.env.NEXTBOT_DB_APP_TEST_URL = "postgres://app@localhost/db";
    process.env.NEXTBOT_DB_PLATFORM_TEST_URL = "postgres://platform@localhost/db";
    process.env.NEXTBOT_DB_GATEWAY_TEST_URL = "postgres://gateway@localhost/db";

    const first = loadDbEnv();
    process.env.NEXTBOT_DB_OWNER_TEST_URL = "postgres://changed@localhost/db";
    const second = loadDbEnv();
    expect(second).toBe(first);
  });
});
