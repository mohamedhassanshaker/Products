import type {
  MessageTemplateRepository,
  MessageTemplateRow,
} from "../ports/message-template-repository.js";
import type {
  WhatsAppConfigRepository,
  WhatsAppConfigRow,
} from "../ports/whatsapp-config-repository.js";

export interface WhatsAppSettingsSnapshot {
  readonly config: WhatsAppConfigRow;
  readonly templates: readonly MessageTemplateRow[];
}

/** `GET /channels/whatsapp` + `.../templates` (B10 tab 3), read together. */
export class GetWhatsAppSettings {
  constructor(
    private readonly deps: {
      readonly whatsAppConfig: WhatsAppConfigRepository;
      readonly templates: MessageTemplateRepository;
    },
  ) {}

  async execute(channelId: string): Promise<WhatsAppSettingsSnapshot | null> {
    const config = await this.deps.whatsAppConfig.findByChannelId(channelId);
    if (!config) return null;
    const templates = await this.deps.templates.list();
    return { config, templates };
  }
}
