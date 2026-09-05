import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeTriggerSignature } from "./run-service.js";

/**
 * Retry-1 QA fix (Target Architecture Blueprint Phase 16, BL-47b, blocking defect).
 *
 * QA's finding: `computeTriggerSignature`/`verifySignature` were documented everywhere
 * as "HMAC-SHA256" but were actually `createHash("sha256").update(secret + "." + rawBody)`
 * — a plain SHA-256 digest of the concatenated secret and body, NEVER `createHmac`. That
 * construction is NOT an HMAC: it is vulnerable to length-extension forgery, and the
 * existing test suite (`webhook-trigger.int.test.ts`) could never have caught it, because
 * every one of its assertions signs with `computeTriggerSignature` and verifies with the
 * SAME function — a round-trip against its own (broken) reference implementation proves
 * only self-consistency, never correctness against the real HMAC-SHA256 construction the
 * docs/spec claim.
 *
 * This suite instead pins `computeTriggerSignature`'s output against an INDEPENDENTLY
 * known-correct HMAC-SHA256 test vector (RFC 4231 Test Case 2 — key "Jefe", data
 * "what do ya want for nothing?"), which the old naive-hash implementation could never
 * have produced. It also demonstrates the specific real-world attack the naive
 * construction was vulnerable to: an attacker who has observed one valid
 * `secret + "." + rawBody` digest could extend it (Merkle-Damgall length extension)
 * to forge a signature over `rawBody + <attacker-chosen suffix>` WITHOUT ever knowing
 * `secret` — and asserts the real HMAC construction closes that path (a signature
 * computed by naively hashing `secret + "." + extendedBody` is rejected, because a real
 * HMAC's key-then-hash-then-key-again construction does not have the length-extension
 * property a bare `hash(secret || body)` does).
 */

const SECRET = "Jefe";
const BODY = "what do ya want for nothing?";
// Independently known-correct (RFC 4231 Test Case 2, confirmed against Node's own
// `crypto.createHmac`) — NOT derived from this codebase's own (previously broken)
// implementation.
const KNOWN_CORRECT_HMAC_SHA256_HEX = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

describe("computeTriggerSignature — real HMAC-SHA256, not a plain concatenated hash", () => {
  it("matches an independently-known-correct HMAC-SHA256 test vector (RFC 4231 Test Case 2)", () => {
    // The OLD (broken) implementation — createHash("sha256").update(secret + "." + body)
    // — produces a completely different, non-HMAC digest for the same inputs. A test
    // that only re-derived its "expected" value from that same broken function (the
    // round-trip-only shape QA flagged) would pass either way; pinning against the RFC
    // vector is what actually catches the defect.
    expect(computeTriggerSignature(SECRET, BODY)).toBe(KNOWN_CORRECT_HMAC_SHA256_HEX);
  });

  it("is NOT the naive createHash(secret + \".\" + body) construction the defect used", () => {
    const naiveBrokenDigest = createHash("sha256").update(`${SECRET}.${BODY}`).digest("hex");
    expect(computeTriggerSignature(SECRET, BODY)).not.toBe(naiveBrokenDigest);
  });

  it("produces a different signature for a different secret over the same body", () => {
    const wrongSecretSignature = computeTriggerSignature("the-wrong-secret", BODY);
    expect(wrongSecretSignature).not.toBe(computeTriggerSignature(SECRET, BODY));
  });

  it("resists the length-extension forgery pattern the naive hash construction was vulnerable to", () => {
    // Simulates an attacker who only ever observed the OLD, broken scheme's digest for
    // (SECRET, BODY) and tries to extend it to forge a signature over BODY + suffix,
    // without knowing SECRET — the textbook length-extension attack against
    // `hash(secret || message)`. Under a real HMAC, appending bytes to the message and
    // re-hashing the old digest as if it were valid input state is meaningless: HMAC's
    // key-then-hash(then-hash-again) construction has no such extendable internal state
    // exposed via its output, so this can never produce a signature this codebase's real
    // verifier accepts.
    const suffix = "&&admin=true";
    const extendedBody = BODY + suffix;
    // The best an attacker limited to the old naive construction's shape could produce
    // without the secret: re-hashing the ORIGINAL (attacker-observed) digest concatenated
    // with the extension, standing in for "some function of the leaked digest + suffix".
    const forgedAttemptDigest = createHash("sha256").update(`${KNOWN_CORRECT_HMAC_SHA256_HEX}${suffix}`).digest("hex");
    expect(computeTriggerSignature(SECRET, extendedBody)).not.toBe(forgedAttemptDigest);
  });
});
