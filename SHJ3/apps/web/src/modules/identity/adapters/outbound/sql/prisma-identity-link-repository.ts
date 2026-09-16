/**
 * The real `IdentityLinkRepository` — `IdentityLinks`, per-tenant.
 *
 * `CK_IdentityLinks_verifiedOnly`'s rejection is translated to
 * `identity.stitching_requires_verified` — belt-and-braces alongside
 * `StitchIdentity`'s own pre-check (that use case's doc comment names all
 * three layers).
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isRequiredAssuranceLevel,
  type RequiredAssuranceLevel,
} from "../../../../tools/domain/tool-catalog.js";
import type {
  CreateIdentityLinkResult,
  IdentityLinkRepository,
  IdentityLinkRow,
} from "../../../ports/identity-link-repository.js";

const OPERATION = "identity identity-link repository";
const VERIFIED_ONLY_FRAGMENT = "CK_IdentityLinks_verifiedOnly";

function toRow(row: {
  id: string;
  citizenIdentityId: string;
  channelKey: string;
  channelSubjectHash: string;
  assuranceLevelAtLink: string;
  stitchingKeyUsed: string | null;
  linkedAt: Date;
  unlinkedAt: Date | null;
}): IdentityLinkRow {
  if (!isRequiredAssuranceLevel(row.assuranceLevelAtLink)) {
    throw new Error(`IdentityLink ${row.id} has an unrecognized assuranceLevelAtLink.`);
  }
  return {
    id: row.id,
    citizenIdentityId: row.citizenIdentityId,
    channelKey: row.channelKey,
    channelSubjectHash: row.channelSubjectHash,
    assuranceLevelAtLink: row.assuranceLevelAtLink,
    stitchingKeyUsed: row.stitchingKeyUsed,
    linkedAt: row.linkedAt,
    unlinkedAt: row.unlinkedAt,
  };
}

export class PrismaIdentityLinkRepository implements IdentityLinkRepository {
  async findActiveByChannelSubject(
    channelKey: string,
    channelSubjectHash: string,
  ): Promise<IdentityLinkRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.identityLink.findFirst({
      where: { channelKey, channelSubjectHash, unlinkedAt: null },
    });
    return row ? toRow(row) : null;
  }

  async listActiveForIdentity(citizenIdentityId: string): Promise<readonly IdentityLinkRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.identityLink.findMany({
      where: { citizenIdentityId, unlinkedAt: null },
    });
    return rows.map(toRow);
  }

  async create(input: {
    readonly citizenIdentityId: string;
    readonly channelKey: string;
    readonly channelSubjectHash: string;
    readonly assuranceLevelAtLink: RequiredAssuranceLevel;
    readonly stitchingKeyUsed: string | null;
    readonly now: Date;
  }): Promise<CreateIdentityLinkResult> {
    // Application-layer defence in depth: `Anonymous` cannot be persisted here
    // even if a caller bypassed `StitchIdentity`'s own pre-check.
    if (input.assuranceLevelAtLink === "Anonymous") {
      return { ok: false, reason: "identity.stitching_requires_verified" };
    }

    const db = getTenantDb(OPERATION);
    try {
      const row = await db.identityLink.create({
        data: {
          id: newUlid(input.now),
          citizenIdentityId: input.citizenIdentityId,
          channelKey: input.channelKey,
          channelSubjectHash: input.channelSubjectHash,
          assuranceLevelAtLink: input.assuranceLevelAtLink,
          stitchingKeyUsed: input.stitchingKeyUsed,
          linkedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { ok: true, link: toRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(VERIFIED_ONLY_FRAGMENT)) {
        return { ok: false, reason: "identity.stitching_requires_verified" };
      }
      throw error;
    }
  }

  async unlink(id: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.identityLink.update({ where: { id }, data: { unlinkedAt: now } });
  }
}
