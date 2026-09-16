/**
 * The real `IdentityStitchingConfigRepository` — the `IdentityStitchingConfigs`
 * singleton, per-tenant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  ConversationMemoryScope,
  IdentityStitchingConfigRepository,
  IdentityStitchingConfigRow,
  SetStitchingConfigResult,
  StitchingKey,
} from "../../../ports/identity-stitching-config-repository.js";

const OPERATION = "identity stitching-config repository";
const SINGLETON_KEY = 1;
const INCOHERENT_FRAGMENT = "CK_IdentityStitchingConfigs_neverStitchCoherent";

function toRow(row: {
  stitchAcrossChannels: boolean;
  stitchingKey: string;
  conversationMemoryScope: string;
}): IdentityStitchingConfigRow {
  return {
    stitchAcrossChannels: row.stitchAcrossChannels,
    stitchingKey: row.stitchingKey as StitchingKey,
    conversationMemoryScope: row.conversationMemoryScope as ConversationMemoryScope,
  };
}

export class PrismaIdentityStitchingConfigRepository implements IdentityStitchingConfigRepository {
  async get(): Promise<IdentityStitchingConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.identityStitchingConfig.findUnique({
      where: { singletonKey: SINGLETON_KEY },
    });
    if (existing) return toRow(existing);

    const now = new Date();
    const created = await db.identityStitchingConfig.create({
      data: {
        id: newUlid(now),
        singletonKey: SINGLETON_KEY,
        stitchAcrossChannels: true,
        stitchingKey: "VerifiedEmiratesIdHash",
        conversationMemoryScope: "PerVerifiedIdentity",
        createdAt: now,
        updatedAt: now,
      },
    });
    return toRow(created);
  }

  async set(input: {
    readonly stitchAcrossChannels: boolean;
    readonly stitchingKey: StitchingKey;
    readonly conversationMemoryScope: ConversationMemoryScope;
    readonly now: Date;
  }): Promise<SetStitchingConfigResult> {
    await this.get();
    const db = getTenantDb(OPERATION);
    try {
      const row = await db.identityStitchingConfig.update({
        where: { singletonKey: SINGLETON_KEY },
        data: {
          stitchAcrossChannels: input.stitchAcrossChannels,
          stitchingKey: input.stitchingKey,
          conversationMemoryScope: input.conversationMemoryScope,
          updatedAt: input.now,
        },
      });
      return { ok: true, config: toRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(INCOHERENT_FRAGMENT)) {
        return { ok: false, reason: "identity.stitching_config_incoherent" };
      }
      throw error;
    }
  }
}
