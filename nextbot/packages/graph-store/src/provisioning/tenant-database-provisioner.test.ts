import { describe, expect, it, vi } from "vitest";
import neo4j, { type Session } from "neo4j-driver";
import { runIdempotentDdl } from "./tenant-database-provisioner.js";

function fakeSession(runImpl: (...args: unknown[]) => unknown): Session {
  return { run: vi.fn(runImpl) } as unknown as Session;
}

/** A genuine `Neo4jError` instance (not a plain `Error` with a `.code` property
 *  bolted on) — `neo4j.isRetriableError()` specifically checks `instanceof
 *  Neo4jError && error.retriable`, which only the driver's own constructor sets
 *  correctly (verified against the real `neo4j-driver-core` source during this
 *  phase's implementation). A plain `Object.assign(new Error(...), { code })`
 *  looks right superficially but is never actually classified as retriable. */
function neo4jError(message: string, code: string): Error {
  // gqlStatus/gqlStatusDescription are required by the constructor's type
  // signature but irrelevant to `isRetriableError()`'s classification (verified
  // against the real `neo4j-driver-core` source — it only reads `.retriable`,
  // itself derived from `code`), so placeholders are fine here.
  return new neo4j.Neo4jError(message, code, "N/A", "N/A");
}

describe("runIdempotentDdl (race/retry tolerance, unit — see this package's README for the real-instance findings this codifies)", () => {
  it("succeeds immediately on the happy path", async () => {
    const session = fakeSession(() => Promise.resolve());
    await expect(runIdempotentDdl(session, "CREATE ROLE x IF NOT EXISTS")).resolves.toBeUndefined();
    expect(session.run).toHaveBeenCalledTimes(1);
  });

  it("treats a 'Role already exists' ArgumentError race as success, not a failure", async () => {
    const session = fakeSession(() =>
      Promise.reject(
        Object.assign(new Error("Failed to create the specified role 'x': Role already exists."), {
          code: "Neo.ClientError.Statement.ArgumentError",
        }),
      ),
    );
    await expect(runIdempotentDdl(session, "CREATE ROLE x IF NOT EXISTS")).resolves.toBeUndefined();
  });

  it("treats a 'schema rule already exists' (CREATE INDEX/CONSTRAINT race) as success, not a failure — Phase 7b fast-follow regression for the exact QA-7a repro", async () => {
    const session = fakeSession(() =>
      Promise.reject(
        Object.assign(new Error("An equivalent index already exists, 'Index( id=1, name='entity_id_unique', ... )'."), {
          code: "Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists",
        }),
      ),
    );
    await expect(runIdempotentDdl(session, "CREATE CONSTRAINT entity_id_unique IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE")).resolves.toBeUndefined();
  });

  it("treats a 'Database already exists' race as success, not a failure", async () => {
    const session = fakeSession(() =>
      Promise.reject(
        Object.assign(new Error("Failed to create the specified database 'x': Database name or alias already exists."), {
          code: "Neo.ClientError.Database.ExistingDatabaseFound",
        }),
      ),
    );
    await expect(runIdempotentDdl(session, "CREATE DATABASE x IF NOT EXISTS")).resolves.toBeUndefined();
  });

  it("does NOT treat an unrelated ArgumentError (not an 'already exists' message) as success", async () => {
    const session = fakeSession(() =>
      Promise.reject(
        Object.assign(new Error("Invalid input 'foo' for password."), {
          code: "Neo.ClientError.Statement.ArgumentError",
        }),
      ),
    );
    await expect(runIdempotentDdl(session, "CREATE USER x IF NOT EXISTS SET PASSWORD 'foo'")).rejects.toThrow(
      /Invalid input/,
    );
  });

  it("retries a transient DeadlockDetected error and succeeds once the underlying condition clears", async () => {
    let attempt = 0;
    const session = fakeSession(() => {
      attempt += 1;
      if (attempt < 3) {
        return Promise.reject(neo4jError("deadlock", "Neo.TransientError.Transaction.DeadlockDetected"));
      }
      return Promise.resolve();
    });
    await expect(runIdempotentDdl(session, "CREATE CONSTRAINT x IF NOT EXISTS")).resolves.toBeUndefined();
    expect(attempt).toBe(3);
  });

  it("gives up and throws after maxAttempts transient failures", async () => {
    const session = fakeSession(() => Promise.reject(neo4jError("deadlock", "Neo.TransientError.Transaction.DeadlockDetected")));
    await expect(runIdempotentDdl(session, "CREATE CONSTRAINT x IF NOT EXISTS", {}, 2)).rejects.toThrow(/deadlock/);
    expect(session.run).toHaveBeenCalledTimes(2);
  });

  it("does not retry and rethrows immediately for a non-retriable, non-already-exists error (e.g. a real security rejection)", async () => {
    const session = fakeSession(() =>
      Promise.reject(Object.assign(new Error("forbidden"), { code: "Neo.ClientError.Security.Forbidden" })),
    );
    await expect(runIdempotentDdl(session, "GRANT ACCESS ON DATABASE x TO y")).rejects.toThrow(/forbidden/);
    expect(session.run).toHaveBeenCalledTimes(1);
  });
});
