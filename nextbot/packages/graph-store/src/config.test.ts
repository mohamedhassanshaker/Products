import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetGraphStoreEnvCacheForTests, loadGraphStoreEnv } from "./config.js";

const ENV_KEYS = [
  "NEXTBOT_DB_ENV",
  "GRAPH_STORE_PROVIDER",
  "GRAPH_STORE_URL",
  "GRAPH_STORE_TEST_URL",
  "GRAPH_STORE_SERVICE_USER",
  "GRAPH_STORE_SERVICE_USER_TEST",
  "GRAPH_STORE_CREDENTIAL_REF",
  "GRAPH_STORE_CREDENTIAL_REF_TEST",
  "GRAPH_STORE_ADMIN_USER",
  "GRAPH_STORE_ADMIN_USER_TEST",
  "GRAPH_STORE_ADMIN_CREDENTIAL_REF",
  "GRAPH_STORE_ADMIN_CREDENTIAL_REF_TEST",
  "GRAPH_STORE_DATABASE_PREFIX",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  _resetGraphStoreEnvCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetGraphStoreEnvCacheForTests();
});

describe("loadGraphStoreEnv", () => {
  it("throws synchronously when required vars are missing", () => {
    expect(() => loadGraphStoreEnv()).toThrow(/invalid\/missing configuration/);
  });

  it("resolves non-test vars when NEXTBOT_DB_ENV is not 'test'", () => {
    process.env.GRAPH_STORE_URL = "bolt://localhost:7687";
    process.env.GRAPH_STORE_SERVICE_USER = "svc_graph";
    process.env.GRAPH_STORE_CREDENTIAL_REF = "svc-password";
    process.env.GRAPH_STORE_ADMIN_USER = "neo4j";
    process.env.GRAPH_STORE_ADMIN_CREDENTIAL_REF = "admin-password";
    const env = loadGraphStoreEnv();
    expect(env.GRAPH_STORE_URL).toBe("bolt://localhost:7687");
    expect(env.GRAPH_STORE_PROVIDER).toBe("neo4j");
    expect(env.GRAPH_STORE_DATABASE_PREFIX).toBe("t");
  });

  it("resolves _TEST_ vars when NEXTBOT_DB_ENV=test, ignoring the non-test vars", () => {
    process.env.NEXTBOT_DB_ENV = "test";
    process.env.GRAPH_STORE_URL = "bolt://should-not-be-used:7687";
    process.env.GRAPH_STORE_TEST_URL = "bolt://localhost:57687";
    process.env.GRAPH_STORE_SERVICE_USER_TEST = "svc_graph_test";
    process.env.GRAPH_STORE_CREDENTIAL_REF_TEST = "svc-test-password";
    process.env.GRAPH_STORE_ADMIN_USER_TEST = "neo4j";
    process.env.GRAPH_STORE_ADMIN_CREDENTIAL_REF_TEST = "admin-test-password";
    const env = loadGraphStoreEnv();
    expect(env.GRAPH_STORE_URL).toBe("bolt://localhost:57687");
    expect(env.GRAPH_STORE_SERVICE_USER).toBe("svc_graph_test");
  });

  it("caches after the first successful load", () => {
    process.env.GRAPH_STORE_URL = "bolt://localhost:7687";
    process.env.GRAPH_STORE_SERVICE_USER = "svc_graph";
    process.env.GRAPH_STORE_CREDENTIAL_REF = "svc-password";
    process.env.GRAPH_STORE_ADMIN_USER = "neo4j";
    process.env.GRAPH_STORE_ADMIN_CREDENTIAL_REF = "admin-password";
    const first = loadGraphStoreEnv();
    process.env.GRAPH_STORE_URL = "bolt://changed:7687";
    const second = loadGraphStoreEnv();
    expect(second).toBe(first);
    expect(second.GRAPH_STORE_URL).toBe("bolt://localhost:7687");
  });
});
