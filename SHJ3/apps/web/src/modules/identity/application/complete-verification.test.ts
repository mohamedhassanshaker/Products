import { describe, expect, it } from "vitest";
import { FakeClock } from "../../iam/testing/fakes.js";
import { MockVerificationProvider } from "../../iam/adapters/outbound/mock-verification-provider.js";
import { CompleteVerification } from "./complete-verification.js";
import {
  FakeCitizenIdentityRepository,
  FakeVerificationAttemptRepository,
} from "../testing/fakes.js";

/**
 * `CompleteVerification`'s two real rules, proven against the same
 * `MockVerificationProvider` fixture ADR-0006 rule 5 says the real
 * `UaePassProvider` acceptance suite will be too: assurance never regresses
 * (`strongestAssurance`), and the persisted `CitizenIdentities.assuranceLevel`
 * is the `RequiredAssuranceLevel` enum, never the raw `L0`-`L3` rank.
 */
describe("CompleteVerification", () => {
  const NOW = new Date("2026-09-09T10:00:00.000Z");

  function makeUseCase() {
    const provider = new MockVerificationProvider({ clock: new FakeClock(NOW) });
    const citizenIdentities = new FakeCitizenIdentityRepository();
    const attempts = new FakeVerificationAttemptRepository();
    const useCase = new CompleteVerification({
      provider,
      citizenIdentities,
      attempts,
      clock: { now: () => NOW },
    });
    return { provider, citizenIdentities, attempts, useCase };
  }

  it("mints a fresh CitizenIdentity at the achieved level, mapped to the persisted enum", async () => {
    const { provider, citizenIdentities, useCase } = makeUseCase();
    const challenge = await provider.challenge({
      sessionId: "sess_1",
      targetLevel: "L2",
      channel: "whatsapp",
      locale: "en",
    });

    const result = await useCase.execute({
      challengeId: challenge.challengeId,
      response: { kind: "otp", code: "000000" },
      targetLevel: "L2",
      conversationId: "conv_1",
      existingCitizenIdentityId: null,
      existingHeldAssurance: "L0",
      action: "InitiatePayment",
      providerKey: "OtpSms",
    });

    expect(result.succeeded).toBe(true);
    expect(result.heldAssurance).toBe("L2");
    // The persisted enum, not the rank — `CK_CitizenIdentities_assuranceLevel`'s
    // real closed vocabulary.
    expect(result.citizenIdentity.assuranceLevel).toBe("VerifiedPlusOtp");
    expect(citizenIdentities.rows.size).toBe(1);
  });

  it("never lowers an existing session's held assurance", async () => {
    const { provider, useCase } = makeUseCase();
    // Force the mock to grant a weaker level than requested — the exact case
    // a real provider can produce (identity confirmed, no OTP), and the one
    // `strongestAssurance` exists to guard against regressing on.
    provider.driveTo("L1");
    const challenge = await provider.challenge({
      sessionId: "sess_1",
      targetLevel: "L2",
      channel: "whatsapp",
      locale: "en",
    });

    const result = await useCase.execute({
      challengeId: challenge.challengeId,
      response: { kind: "callback", authorizationCode: "code" },
      targetLevel: "L2",
      conversationId: "conv_1",
      existingCitizenIdentityId: "cid_existing",
      existingHeldAssurance: "L2", // already stronger than what this attempt achieves
      action: "InitiatePayment",
      providerKey: "UaePass",
    });

    expect(result.heldAssurance).toBe("L2"); // not downgraded to L1
    expect(result.succeeded).toBe(false); // honestly recorded: this attempt alone did not reach L2
  });

  it("dedupes by Emirates ID hash — a second independent session for the same person reuses the existing row", async () => {
    // The real bug this proves: `UQ_CitizenIdentities_emiratesIdHash` rejects
    // a second real row with the identical hash. A second anonymous session
    // (`existingCitizenIdentityId: null` — no prior link, an ordinary case,
    // not just a fresh account) verifying the SAME real person must resolve
    // to their already-existing row, never attempt to mint a duplicate.
    // Found live, against the real constraint (`tasks/todo.md`'s B-8 review).
    const { provider, citizenIdentities, useCase } = makeUseCase();

    const firstChallenge = await provider.challenge({
      sessionId: "sess_1",
      targetLevel: "L1",
      channel: "widget",
      locale: "en",
    });
    const first = await useCase.execute({
      challengeId: firstChallenge.challengeId,
      response: { kind: "callback", authorizationCode: "code" },
      targetLevel: "L1",
      conversationId: "conv_1",
      existingCitizenIdentityId: null,
      existingHeldAssurance: "L0",
      action: null,
      providerKey: "UaePass",
    });
    expect(citizenIdentities.rows.size).toBe(1);

    const secondChallenge = await provider.challenge({
      sessionId: "sess_2", // a genuinely different, independent anonymous session
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    const second = await useCase.execute({
      challengeId: secondChallenge.challengeId,
      response: { kind: "otp", code: "000000" },
      targetLevel: "L2",
      conversationId: "conv_2",
      existingCitizenIdentityId: null, // no prior link in THIS session either
      existingHeldAssurance: "L0",
      action: "InitiatePayment",
      providerKey: "OtpSms",
    });

    // Same row, raised — never a second, duplicate CitizenIdentity.
    expect(second.citizenIdentity.id).toBe(first.citizenIdentity.id);
    expect(citizenIdentities.rows.size).toBe(1);
    expect(second.heldAssurance).toBe("L2");
  });

  it("records a failed attempt when the provider rejects the response", async () => {
    const { provider, attempts, useCase } = makeUseCase();
    const challenge = await provider.challenge({
      sessionId: "sess_1",
      targetLevel: "L2",
      channel: "whatsapp",
      locale: "en",
    });
    provider.rejectNext("wrong_code");

    const result = await useCase.execute({
      challengeId: challenge.challengeId,
      response: { kind: "otp", code: "999999" },
      targetLevel: "L2",
      conversationId: "conv_1",
      existingCitizenIdentityId: null,
      existingHeldAssurance: "L0",
      action: "InitiatePayment",
      providerKey: "OtpSms",
    });

    expect(result.succeeded).toBe(false);
    expect(result.heldAssurance).toBe("L0");
    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]?.result).toBe("Failed");
  });
});
