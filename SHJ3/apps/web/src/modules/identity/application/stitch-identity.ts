/**
 * Join a channel subject to a verified identity — B11 tab 5's stitching join,
 * and the use case FR-VERI-11's negative test targets directly:
 * **an anonymous session's history must never be merged into a verified
 * identity's record.**
 *
 * Three independent layers enforce this, deliberately redundant:
 *  1. This use case refuses to even call the repository when `heldAssurance`
 *     is `L0` (`ANONYMOUS_ASSURANCE`) — fails before any I/O.
 *  2. `IdentityLinkRepository.create()`'s own contract (see that port's doc
 *     comment) returns `identity.stitching_requires_verified` rather than
 *     silently creating the row, so a caller that bypassed layer 1 (a second
 *     application-layer entry point, a script) still cannot succeed.
 *  3. `CK_IdentityLinks_verifiedOnly` — the database itself has no column state
 *     that could represent an anonymous link, so even a hand-crafted `INSERT`
 *     against the real adapter fails.
 *
 * Also honours B11 tab 5's on/off switch and stitching-key selection
 * (`IdentityStitchingConfigs`) — `stitchAcrossChannels = false` or
 * `stitchingKey = "NeverStitch"` both refuse to link, matching the config
 * screen's own toggle rather than leaving it decorative.
 */

import {
  ANONYMOUS_ASSURANCE,
  assuranceRank,
  type AssuranceLevel,
} from "../../iam/domain/assurance.js";
import { assuranceToRequiredLevel } from "../domain/assurance-mapping.js";
import type { IdentityStitchingConfigRepository } from "../ports/identity-stitching-config-repository.js";
import type {
  CreateIdentityLinkResult,
  IdentityLinkRepository,
} from "../ports/identity-link-repository.js";

export interface StitchIdentityInput {
  readonly citizenIdentityId: string;
  readonly heldAssurance: AssuranceLevel;
  readonly channelKey: string;
  readonly channelSubjectHash: string;
  readonly now: Date;
}

export type StitchIdentityResult =
  CreateIdentityLinkResult | { readonly ok: false; readonly reason: "identity.stitching_disabled" };

export interface StitchIdentityDeps {
  readonly config: IdentityStitchingConfigRepository;
  readonly links: IdentityLinkRepository;
}

export class StitchIdentity {
  constructor(private readonly deps: StitchIdentityDeps) {}

  async execute(input: StitchIdentityInput): Promise<StitchIdentityResult> {
    // Layer 1 — refuse before any I/O. `assuranceRank` throws on garbage, which
    // is correct here: an unrecognised level reaching this use case is a
    // programming error, not "treat it as anonymous."
    if (assuranceRank(input.heldAssurance) <= assuranceRank(ANONYMOUS_ASSURANCE)) {
      return { ok: false, reason: "identity.stitching_requires_verified" };
    }

    const config = await this.deps.config.get();
    if (!config.stitchAcrossChannels || config.stitchingKey === "NeverStitch") {
      return { ok: false, reason: "identity.stitching_disabled" };
    }

    return this.deps.links.create({
      citizenIdentityId: input.citizenIdentityId,
      channelKey: input.channelKey,
      channelSubjectHash: input.channelSubjectHash,
      assuranceLevelAtLink: assuranceToRequiredLevel(input.heldAssurance),
      stitchingKeyUsed: config.stitchingKey,
      now: input.now,
    });
  }
}
