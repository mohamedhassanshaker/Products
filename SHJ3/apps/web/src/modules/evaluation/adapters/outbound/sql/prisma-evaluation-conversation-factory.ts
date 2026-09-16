import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  EVALUATION_CONVERSATION_INTENT_KEY,
  type EvaluationConversationFactory,
  type NewEvaluationConversationInput,
} from "../../../ports/evaluation-conversation-factory.js";

/** `CK_Conversations_channelKey` admits only these four values — see this port's own
 *  module doc comment for why "WebWidget" (not a dedicated evaluation value) is the least-
 *  wrong real choice available, and the flagged, real gap that comes with it. */
const SYNTHETIC_CHANNEL_KEY = "WebWidget";

export class PrismaEvaluationConversationFactory implements EvaluationConversationFactory {
  async create(input: NewEvaluationConversationInput): Promise<string> {
    const id = newUlid();
    await getTenantDb("evaluation synthetic conversation create").conversation.create({
      data: {
        id,
        channelKey: SYNTHETIC_CHANNEL_KEY,
        localeCode: input.localeCode,
        citizenIdentityId: null,
        primaryAgentId: input.agentId,
        intentKey: EVALUATION_CONVERSATION_INTENT_KEY,
        outcome: "Resolved",
        wasContained: true,
        turnCount: 0,
        startedAt: input.now,
        lastTurnAt: input.now,
        endedAt: input.now,
        piiMaskApplied: true,
        // Already expired at creation — a deliberate partial mitigation for the
        // "no evaluation-origin marker exists" gap this port's own doc comment names:
        // the standing retention sweep reclaims this row at its very next pass rather
        // than the ordinary 90-day window.
        retentionExpiresAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return id;
  }
}
