import type { WhatsAppConfigRepository } from "../ports/whatsapp-config-repository.js";

export interface UpdateWhatsAppConfigInput {
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly wabaId: string;
  readonly optInRequired: boolean;
  readonly now: Date;
}

/** `PUT /channels/whatsapp` (B10 tab 3). `sessionWindowHours` is deliberately absent from
 *  this input — pinned at 24 by `CK_WhatsAppConfigs_sessionWindow`, "read-only in effect"
 *  because it is Meta's own platform rule, surfaced rather than configured. */
export class UpdateWhatsAppConfig {
  constructor(private readonly deps: { readonly whatsAppConfig: WhatsAppConfigRepository }) {}

  async execute(input: UpdateWhatsAppConfigInput): Promise<void> {
    await this.deps.whatsAppConfig.update({
      channelId: input.channelId,
      phoneNumber: input.phoneNumber,
      wabaId: input.wabaId,
      optInRequired: input.optInRequired,
      now: input.now,
    });
  }
}
