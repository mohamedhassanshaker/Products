import type { BspProvider } from "../domain/vocabulary.js";

export interface WhatsAppConfigRow {
  readonly id: string;
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly bspProvider: BspProvider;
  readonly optInRequired: boolean;
  /** Pinned at 24 by `CK_WhatsAppConfigs_sessionWindow` — read-only in effect. */
  readonly sessionWindowHours: number;
  readonly credentialSecretRef: string;
  readonly webhookVerifySecretRef: string;
}

export interface UpdateWhatsAppConfigInput {
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly wabaId: string;
  readonly optInRequired: boolean;
  readonly now: Date;
}

/**
 * The real "Connect WhatsApp" onboarding input (`application/connect-whatsapp.ts`) —
 * everything `WhatsAppConfigs` needs that `UpdateWhatsAppConfigInput` deliberately omits:
 * `bspProvider` (pinned to the one real value, `MetaCloudApi` — `BSP_PROVIDERS`) and
 * `sessionWindowHours` (pinned to 24, `CK_WhatsAppConfigs_sessionWindow`) are never accepted
 * from a caller, only `create()`'s own implementation ever sets them.
 */
export interface CreateWhatsAppConfigInput {
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly optInRequired: boolean;
  readonly credentialSecretRef: string;
  readonly webhookVerifySecretRef: string;
  readonly now: Date;
}

export interface WhatsAppConfigRepository {
  findByChannelId(channelId: string): Promise<WhatsAppConfigRow | null>;
  /** Looks up by Meta's `phone_number_id` — the one field the inbound webhook can resolve a
   *  tenant from. Callers of this method run under `platformScope: "channel-routing"`,
   *  enumerating candidate tenants (see `resolve-tenant-by-phone-number.ts`). */
  findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppConfigRow | null>;
  /** The real "Connect WhatsApp" write — a channel with no `WhatsAppConfig` row yet, closing
   *  the genuine dead end B10 tab 3 had for any tenant besides the hand-seeded `sewa` demo. */
  create(input: CreateWhatsAppConfigInput): Promise<WhatsAppConfigRow>;
  update(input: UpdateWhatsAppConfigInput): Promise<void>;
}
