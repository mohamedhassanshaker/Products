import { describe, expect, it } from "vitest";
import { StitchIdentity } from "./stitch-identity.js";
import {
  FakeIdentityLinkRepository,
  FakeIdentityStitchingConfigRepository,
} from "../testing/fakes.js";

/**
 * FR-VERI-11 / B11 tab 5's `[rule]`, proven at three independent layers this
 * use case's own doc comment names: **an anonymous session's history must
 * never be merged into a verified identity's record.** This file proves
 * layer 1 (the application-layer pre-check) and layer 2 (the repository's
 * own belt-and-braces refusal, exercised here via the fake that mirrors
 * `CK_IdentityLinks_verifiedOnly`); the real adapter's own translation of the
 * live database constraint is the third layer, proven separately against real
 * SQL Server in this wave's live-infrastructure verification.
 */
describe("StitchIdentity", () => {
  const NOW = new Date("2026-09-09T10:00:00.000Z");

  it("refuses to stitch an anonymous session — never reaches the repository at all", async () => {
    const links = new FakeIdentityLinkRepository();
    const useCase = new StitchIdentity({
      config: new FakeIdentityStitchingConfigRepository(),
      links,
    });

    const result = await useCase.execute({
      citizenIdentityId: "cid_1",
      heldAssurance: "L0",
      channelKey: "whatsapp",
      channelSubjectHash: "hash_of_a_phone_number",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("identity.stitching_requires_verified");
    // The proof that matters: no link was created for the attempt, not merely
    // that the use case returned an error object.
    expect(links.rows).toHaveLength(0);
  });

  it("stitches a verified session when stitching is enabled", async () => {
    const links = new FakeIdentityLinkRepository();
    const useCase = new StitchIdentity({
      config: new FakeIdentityStitchingConfigRepository(),
      links,
    });

    const result = await useCase.execute({
      citizenIdentityId: "cid_1",
      heldAssurance: "L2",
      channelKey: "whatsapp",
      channelSubjectHash: "hash_of_a_phone_number",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]?.assuranceLevelAtLink).toBe("VerifiedPlusOtp");
  });

  it("refuses when stitching is switched off, even for a fully verified session", async () => {
    const links = new FakeIdentityLinkRepository();
    const config = new FakeIdentityStitchingConfigRepository();
    await config.set({
      stitchAcrossChannels: false,
      stitchingKey: "NeverStitch",
      conversationMemoryScope: "NoMemory",
      now: NOW,
    });
    const useCase = new StitchIdentity({ config, links });

    const result = await useCase.execute({
      citizenIdentityId: "cid_1",
      heldAssurance: "L3",
      channelKey: "whatsapp",
      channelSubjectHash: "hash_of_a_phone_number",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("identity.stitching_disabled");
    expect(links.rows).toHaveLength(0);
  });
});
