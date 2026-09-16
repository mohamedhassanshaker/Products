/**
 * `POST /api/public/v1/conversations` (api.md §4.2) — mint the citizen
 * session (see `ports/conversation-repository.ts`'s doc comment on
 * `subjectId === conversationId`), create the `Conversation` row, and return
 * the greeting turn + chips a fresh widget paints immediately.
 *
 * The greeting itself is **not** an AI turn — A2's own step table lists step
 * 1 ("Greeting") with "—" as the user input and a static welcome text, and
 * api.md never asks this endpoint to call `shj3-ai`. It is rendered directly
 * from `WidgetConfig.greetingText`, exactly like the disclaimer and composer
 * placeholder, and is not persisted as a `ConversationTurn` row (that table
 * is AI-writable only, per its own schema comment) — the widget renders it
 * client-side as turn zero, ordinal 0, never round-tripped to the server.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { ANONYMOUS_ASSURANCE } from "../../iam/domain/assurance.js";
import {
  CITIZEN_SESSION_TTL,
  type ClientBinding,
  type SessionRecord,
} from "../../iam/domain/session.js";
import type { SessionStore } from "../../iam/ports/session-store.js";
import type { PublicChannelKind } from "../domain/channel-key.js";
import type { ConversationRepository } from "../ports/conversation-repository.js";
import type { QuickActionRepository } from "../ports/quick-action-repository.js";
import type { WidgetChannelRepository } from "../ports/widget-channel-repository.js";

/** api.md §4.2: "`403 conversation.channel_disabled` if the channel is Disabled." */
export class ChannelDisabledError extends Error {
  readonly code = "conversation.channel_disabled";
  readonly status = 403;
  constructor() {
    super("This channel is not currently live.");
    this.name = "ChannelDisabledError";
  }
}

/** How long a conversation is retained before the retention sweep erases it — a fixed, generous default; a per-tenant override belongs to a governance screen this wave does not touch. */
const CONVERSATION_RETENTION_DAYS = 90;

export interface OpenConversationInput {
  readonly channelKind: PublicChannelKind;
  readonly localeCode: string;
  readonly tenant: TenantSlug;
  readonly binding: ClientBinding;
  readonly now: Date;
}

export interface OpenConversationResult {
  readonly conversationId: string;
  readonly session: SessionRecord;
  readonly greeting: {
    readonly text: string;
    readonly disclaimerText: string;
    readonly showDisclaimerDismiss: boolean;
  };
  readonly chips: readonly { readonly id: string; readonly label: string }[];
}

export class OpenConversation {
  constructor(
    private readonly deps: {
      readonly conversations: ConversationRepository;
      readonly widgetChannels: WidgetChannelRepository;
      readonly quickActions: QuickActionRepository;
      readonly sessions: SessionStore;
    },
  ) {}

  async execute(input: OpenConversationInput): Promise<OpenConversationResult> {
    const channel = await this.deps.widgetChannels.findChannelByKind(input.channelKind);
    if (!channel || channel.state !== "Live") throw new ChannelDisabledError();

    const widgetConfig = await this.deps.widgetChannels.findWidgetConfig(channel.channelId);

    const retentionExpiresAt = new Date(
      input.now.getTime() + CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );

    // The repository mints the id (matches `PrismaKnowledgeSourceRepository`'s
    // own convention) — `application/` may not import the `ulid.js` adapter
    // directly (architecture.md §4's swap test).
    const conversation = await this.deps.conversations.create({
      channelKey: input.channelKind,
      localeCode: input.localeCode,
      startedAt: input.now,
      retentionExpiresAt,
    });
    const conversationId = conversation.id;

    // subjectId === conversationId — see conversation-repository.ts's own doc
    // comment for why this is the whole of this module's session scoping.
    const session = await this.deps.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: conversationId,
        tenant: input.tenant,
        displayName: "",
        assurance: ANONYMOUS_ASSURANCE,
        epoch: 0,
        binding: input.binding,
        ttl: CITIZEN_SESSION_TTL,
      },
      input.now,
    );

    const chips = await this.deps.quickActions.listForChannel(input.channelKind, input.localeCode);

    return {
      conversationId,
      session,
      greeting: {
        text: widgetConfig?.greetingText ?? "",
        disclaimerText: widgetConfig?.disclaimerText ?? "",
        showDisclaimerDismiss: widgetConfig?.showDisclaimerDismiss ?? true,
      },
      chips: chips.map((chip) => ({ id: chip.id, label: chip.label })),
    };
  }
}
