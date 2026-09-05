import type { TenantContext } from "@nextbot/db";
import type { WidgetSessionClaims } from "./widget-session-token.js";
import { updateConversationLanguage } from "../infrastructure/conversation-repository.js";

/** FR-OC-07: persists the customer's explicit language selection (A.1.4 language
 * modal) against the conversation, so a reconnect/reload keeps using it rather than
 * re-running auto-detection. */
export async function setWidgetLanguage(session: WidgetSessionClaims, language: string): Promise<void> {
  const ctx: TenantContext = { tenantId: session.tenantId, region: session.region, environment: session.environment };
  await updateConversationLanguage(ctx, session.conversationId, language);
}
