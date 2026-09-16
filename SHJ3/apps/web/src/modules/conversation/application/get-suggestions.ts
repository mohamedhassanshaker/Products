/**
 * `GET /api/public/v1/suggestions?channelKey=...&conversationId=...` (api.md
 * §4.2) — config-driven chips, never model-generated.
 *
 * **Honest scope trim** (named in this module's own brief, matching B-5's own
 * precedent of naming what it didn't build rather than faking it): a
 * `conversationId` narrows to the channel-scoped `QuickAction` list exactly
 * as the no-`conversationId` path does — wiring live, flow-node-specific
 * chips (reading `ConversationSlots`/flow state to pick a *different* chip
 * set per pending node) would need this module to reach into `modules/flows`
 * for the current node's own configured suggestions, which is out of scope
 * for this pass. The static, channel-scoped fallback is what ships.
 */

import type { PublicChannelKind } from "../domain/channel-key.js";
import type { QuickActionRepository } from "../ports/quick-action-repository.js";

export class GetSuggestions {
  constructor(private readonly deps: { readonly quickActions: QuickActionRepository }) {}

  async execute(input: {
    readonly channelKind: PublicChannelKind;
    readonly localeCode: string;
  }): Promise<readonly { readonly id: string; readonly label: string }[]> {
    const chips = await this.deps.quickActions.listForChannel(input.channelKind, input.localeCode);
    return chips.map((chip) => ({ id: chip.id, label: chip.label }));
  }
}
