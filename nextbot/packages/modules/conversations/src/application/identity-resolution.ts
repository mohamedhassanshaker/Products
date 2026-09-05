import { getIdentityResolutionPolicy } from "@nextbot/tenancy";
import { findChannelById } from "@nextbot/channels";
import type { TenantContext } from "@nextbot/db";
import { findConversationById, findConversationsByCustomerIdentifierHash, type ConversationRow } from "../infrastructure/conversation-repository.js";

/** One "other-channel" conversation linked to the same underlying customer identity
 * (FR-OC-08) — deliberately a thin summary (id/channel/status/timing), never the full
 * transcript, so surfacing this never leaks more of another conversation's content
 * than an admin/agent needs to decide whether to look further. */
export interface LinkedConversationSummary {
  conversationId: string;
  channelId: string;
  channelType: string | null;
  status: ConversationRow["status"];
  startedAt: Date;
  lastActivityAt: Date;
}

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — resolves every OTHER
 * conversation in this tenant that shares the SAME underlying customer identity as
 * `conversationId`, for context continuity across channels.
 *
 * **Fail-closed by construction, not by convention**: returns `[]` immediately (no
 * query against `conversation` for a match ever runs) unless BOTH (a) the tenant has
 * explicitly opted into cross-channel identity linking
 * (`tenant_identity_resolution_policy.enabled`, OFF by default) AND (b) the source
 * conversation itself has a non-null `customerIdentifierHash`. When both hold, the
 * match is an EXACT `customerIdentifierHash` equality only — there is no
 * fuzzy/inferred matching anywhere in this codebase (FR-OC-08's hard requirement:
 * "incorrectly merging two different customers is a worse failure than not merging
 * them").
 */
export async function resolveLinkedConversations(ctx: TenantContext, conversationId: string): Promise<LinkedConversationSummary[]> {
  const policy = await getIdentityResolutionPolicy(ctx);
  if (!policy.enabled) return [];

  const source = await findConversationById(ctx, conversationId);
  if (!source) return [];

  const hash = source.customerIdentifierHash;
  if (!hash) return [];

  const matches = await findConversationsByCustomerIdentifierHash(ctx, hash, conversationId);
  return Promise.all(
    matches.map(async (m) => {
      const channel = await findChannelById(ctx, m.channelId).catch(() => null);
      return {
        conversationId: m.id,
        channelId: m.channelId,
        channelType: channel?.type ?? null,
        status: m.status,
        startedAt: m.startedAt,
        lastActivityAt: m.lastActivityAt,
      };
    }),
  );
}
