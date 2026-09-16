import type { ChannelRepository } from "../ports/channel-repository.js";
import type { ChannelState } from "../domain/vocabulary.js";

export interface UpdateChannelInput {
  readonly id: string;
  readonly state: ChannelState;
  readonly boundAgentId: string | null;
  readonly now: Date;
}

export type UpdateChannelResult =
  | { readonly ok: true; readonly openConversations: number }
  | { readonly ok: false; readonly reason: "channels.agent_required" };

/** `PATCH /channels/{id}` (api.md §6.9, B10 tab 1). Going `Live` with no bound agent is
 *  refused here (a fast, clean 422) even though `CK_Channels_liveNeedsAgent` would refuse
 *  it at the database too — both hold, and this is the one that gives the admin a named
 *  reason instead of a raw constraint violation.
 *
 * "Disabling a channel stops new conversations immediately and lets open ones finish" (B10
 * tab 1 rule, FR-CHAN-02) needs no extra code here beyond the state flip: `Channel.state` is
 * read at NEW-session creation (outside this module's scope in this wave — the citizen-
 * surface conversation module owns that check), and `Conversations` rows reference
 * `channelKey` as a value, never a live FK, so an already-open conversation is structurally
 * untouched by this write (`prisma/tenant/schema.prisma`'s own doc comment on `Channel`).
 * `openConversations` is returned so the admin can see how many are still draining. */
export class UpdateChannel {
  constructor(private readonly deps: { readonly channels: ChannelRepository }) {}

  async execute(input: UpdateChannelInput): Promise<UpdateChannelResult> {
    if (input.state === "Live" && !input.boundAgentId) {
      return { ok: false, reason: "channels.agent_required" };
    }

    await this.deps.channels.update({
      id: input.id,
      state: input.state,
      boundAgentId: input.boundAgentId,
      now: input.now,
    });

    const channel = await this.deps.channels.findById(input.id);
    const openConversations = channel
      ? await this.deps.channels.countOpenConversations(channel.key)
      : 0;
    return { ok: true, openConversations };
  }
}
