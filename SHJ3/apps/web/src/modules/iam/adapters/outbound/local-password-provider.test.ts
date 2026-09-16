import { describe, expect, it } from "vitest";
import {
  ARGON2ID_PARAMETERS,
  PASSWORD_ALGORITHM,
  SECOND_FACTOR_PERMISSIONS,
  createArgon2idHasher,
  requiresSecondFactor,
  type Argon2idParameters,
} from "./local-password-provider.js";

/**
 * Argon2id hashing and the second-factor policy.
 *
 * ## What is deliberately not tested at production parameters
 *
 * 19 MiB and two passes is tens of milliseconds per call *by design* — that cost
 * is the control. So the round-trip behaviour is asserted with `TEST_PARAMETERS`
 * (`m = 8 KiB`, `t = 1`), which exercises exactly the same code path at a
 * thousandth of the cost, and exactly one hash is taken at the real parameters to
 * prove the PHC string they produce is what the database's CHECK constraint
 * expects. Everything else in the auth suite uses `FakePasswordHasher`.
 *
 * Verification reads its parameters out of the PHC string, so a hash written at
 * minimal cost verifies correctly without any special handling — which is also
 * why raising the parameters later does not invalidate stored hashes.
 *
 * Covers ADR-0006 rule 4.
 */

/** Minimal but valid. Not a configuration any environment may use. */
const TEST_PARAMETERS: Argon2idParameters = {
  memoryCost: 8,
  timeCost: 1,
  parallelism: 1,
  outputLen: 32,
};

describe("the parameter choice", () => {
  it("is OWASP's Argon2id baseline", () => {
    // m = 19456 KiB, t = 2, p = 1 — derived from RFC 9106's second recommended
    // option. Asserted so a well-meaning "optimisation" of these numbers has to
    // change a test that says why they are what they are.
    expect(ARGON2ID_PARAMETERS).toEqual({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  });

  it("keeps parallelism at one", () => {
    // Above one, the memory pool is allocated per thread. Under concurrent
    // sign-ins on a shared pod that turns a CPU-hardness setting into a
    // memory-exhaustion vector.
    expect(ARGON2ID_PARAMETERS.parallelism).toBe(1);
  });

  it("declares the algorithm the CHECK constraint pins", () => {
    // `CK_StaffCredentials_algorithm CHECK (passwordAlgorithm = 'argon2id')`.
    expect(PASSWORD_ALGORITHM).toBe("argon2id");
    expect(createArgon2idHasher().algorithm).toBe(PASSWORD_ALGORITHM);
  });

  it("produces an argon2id PHC string carrying those parameters", async () => {
    // The one hash taken at production parameters. The parameters travel inside
    // the string, which is what makes a later increase a transparent upgrade
    // rather than a forced password reset for everyone.
    const encoded = await createArgon2idHasher().hash("correct-horse-battery-staple");
    expect(encoded.startsWith("$argon2id$")).toBe(true);
    expect(encoded).toContain("m=19456,t=2,p=1");
  });
});

describe("hashing round trip", () => {
  const hasher = createArgon2idHasher(TEST_PARAMETERS);

  it("verifies the correct password", async () => {
    const encoded = await hasher.hash("correct-horse");
    await expect(hasher.verify(encoded, "correct-horse")).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const encoded = await hasher.hash("correct-horse");
    await expect(hasher.verify(encoded, "correct-horsf")).resolves.toBe(false);
    await expect(hasher.verify(encoded, "")).resolves.toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    // Without a per-hash salt, two users with the same password are visibly the
    // same user to anyone who reads the table.
    const [first, second] = await Promise.all([hasher.hash("shared"), hasher.hash("shared")]);
    expect(first).not.toBe(second);
    await expect(hasher.verify(first, "shared")).resolves.toBe(true);
    await expect(hasher.verify(second, "shared")).resolves.toBe(true);
  });

  it("handles a long unicode passphrase", async () => {
    const passphrase = "مرحبا-كلمة-مرور-طويلة-جدا-٢٠٢٦-🔐".repeat(4);
    const encoded = await hasher.hash(passphrase);
    await expect(hasher.verify(encoded, passphrase)).resolves.toBe(true);
  });

  it("reads a wrong password out of a corrupt stored hash, rather than throwing", async () => {
    // A malformed row must not become a 500. That would be a denial of service
    // against one account and an obvious signal that the row is special.
    for (const corrupt of ["", "not-a-hash", "$argon2id$broken", "$2y$10$bcrypt-shaped"]) {
      await expect(hasher.verify(corrupt, "correct-horse")).resolves.toBe(false);
    }
  });

  it("verifies a hash written at other parameters, because they travel in the string", async () => {
    const weak = await createArgon2idHasher(TEST_PARAMETERS).hash("correct-horse");
    await expect(createArgon2idHasher().verify(weak, "correct-horse")).resolves.toBe(true);
  });
});

describe("needsRehash", () => {
  it("flags a hash written below current policy", async () => {
    const weak = await createArgon2idHasher(TEST_PARAMETERS).hash("correct-horse");
    expect(createArgon2idHasher().needsRehash(weak)).toBe(true);
  });

  it("leaves a hash at current policy alone", async () => {
    const current = createArgon2idHasher();
    expect(current.needsRehash(await current.hash("correct-horse"))).toBe(false);
  });

  it("flags anything it cannot parse", () => {
    // Unparseable means it was not written by this policy, so it needs replacing
    // by definition.
    expect(createArgon2idHasher().needsRehash("not-a-hash")).toBe(true);
  });
});

describe("which roles must present a second factor", () => {
  it("is publishing and user management, and nothing else", () => {
    // ADR-0006 rule 4. Those two are the actions that cannot be undone by
    // fixing a mistake: a published agent has already answered citizens, and a
    // granted role has already been used.
    expect([...SECOND_FACTOR_PERMISSIONS].sort()).toEqual(["agents:publish", "users:manage"]);
  });

  it("requires a second factor from anyone holding either", () => {
    expect(requiresSecondFactor(new Set(["agents:publish"]))).toBe(true);
    expect(requiresSecondFactor(new Set(["users:manage"]))).toBe(true);
    expect(requiresSecondFactor(new Set(["dashboard:view", "users:manage"]))).toBe(true);
  });

  it("does not require one from a role that can only build", () => {
    // The separation of duties in B9's [rule]: an Agent Designer builds but does
    // not publish, so nothing they can do is irreversible.
    expect(requiresSecondFactor(new Set(["dashboard:view", "agents:manage"]))).toBe(false);
  });

  it("does not require one from an empty permission set", () => {
    expect(requiresSecondFactor(new Set())).toBe(false);
  });

  it("is not fooled by a near-miss permission name", () => {
    expect(
      requiresSecondFactor(new Set(["agents.publish", "AGENTS:PUBLISH", "users:manage "])),
    ).toBe(false);
  });
});
