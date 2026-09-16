import type { ChannelRepository, ChannelRow } from "../ports/channel-repository.js";

export interface ListChannelsResult {
  readonly rows: readonly ChannelRow[];
}

/** B10 tab 1's table. Read-only — no rule to enforce on a plain list. */
export class ListChannels {
  constructor(private readonly deps: { readonly channels: ChannelRepository }) {}

  async execute(): Promise<ListChannelsResult> {
    return { rows: await this.deps.channels.list() };
  }
}
