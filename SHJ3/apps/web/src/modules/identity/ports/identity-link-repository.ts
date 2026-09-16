/**
 * `IdentityLinks` — one channel subject bound to one identity, the stitching
 * join (B11 tab 5).
 *
 * `CK_IdentityLinks_verifiedOnly` is the database's own enforcement of FR-VERI-11
 * ("stitch only verified sessions, and never merge an anonymous session into a
 * verified identity"); `create()` below is this port's structural mirror of
 * that same rule, rejecting an `Anonymous` link attempt **before** it reaches
 * SQL, so a test can prove the block without needing a live constraint
 * violation to observe it.
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";

export interface IdentityLinkRow {
  readonly id: string;
  readonly citizenIdentityId: string;
  readonly channelKey: string;
  readonly channelSubjectHash: string;
  readonly assuranceLevelAtLink: RequiredAssuranceLevel;
  readonly stitchingKeyUsed: string | null;
  readonly linkedAt: Date;
  readonly unlinkedAt: Date | null;
}

export type CreateIdentityLinkResult =
  | { readonly ok: true; readonly link: IdentityLinkRow }
  | {
      readonly ok: false;
      /** FR-VERI-11 — an anonymous session can never be the source of a stitching link. */
      readonly reason: "identity.stitching_requires_verified";
    };

export interface IdentityLinkRepository {
  /** The live (`unlinkedAt IS NULL`) link for a channel subject, if one exists. */
  findActiveByChannelSubject(
    channelKey: string,
    channelSubjectHash: string,
  ): Promise<IdentityLinkRow | null>;

  listActiveForIdentity(citizenIdentityId: string): Promise<readonly IdentityLinkRow[]>;

  create(input: {
    readonly citizenIdentityId: string;
    readonly channelKey: string;
    readonly channelSubjectHash: string;
    readonly assuranceLevelAtLink: RequiredAssuranceLevel;
    readonly stitchingKeyUsed: string | null;
    readonly now: Date;
  }): Promise<CreateIdentityLinkResult>;

  unlink(id: string, now: Date): Promise<void>;
}
