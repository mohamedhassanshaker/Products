import { isValidSecretReference } from "../domain/secret-reference.js";
import type { ChannelsReason } from "../domain/errors.js";
import type {
  WhatsAppConfigRepository,
  WhatsAppConfigRow,
} from "../ports/whatsapp-config-repository.js";

export interface ConnectWhatsAppInput {
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly optInRequired: boolean;
  readonly credentialSecretRef: string;
  readonly webhookVerifySecretRef: string;
  readonly now: Date;
}

export type ConnectWhatsAppResult =
  | { readonly ok: true; readonly config: WhatsAppConfigRow }
  | { readonly ok: false; readonly reason: ChannelsReason };

/**
 * `POST /channels/whatsapp/connect` (B10 tab 3) — the real "Connect WhatsApp" onboarding
 * action this screen was genuinely missing (a reviewer's own words: "How I can connect
 * whatsapp and so on."). `ProvisionDefaultChannelsForTenant`'s own doc comment already
 * reasons through why a `WhatsAppConfig` row cannot be defaulted the way `WidgetConfig` is —
 * a real phone number and BSP/WABA account cannot be fabricated — so every tenant besides the
 * hand-seeded `sewa` demo landed on a genuine dead end: "not provisioned", no path forward.
 * This use case is that path: it persists real, admin-supplied configuration, and never calls
 * the real Meta Graph API itself (no sandbox credentials exist in this environment, matching
 * `TestApiConnector`'s own honest non-implementation for the identical reason).
 *
 * Two real refusals, both checked here rather than left to a raw database error: a channel
 * that already has a `WhatsAppConfig` row (this is "connect", not "reconnect" — `UpdateWhatsAppConfig`
 * is the existing, separate edit path for an already-connected channel), and a credential
 * reference that does not follow this codebase's own `env:`/`k8s:`/`vault:` convention
 * (`CK_WhatsAppConfigs_secretIsReference`'s own real vocabulary, mirrored by
 * `isValidSecretReference`).
 */
export class ConnectWhatsApp {
  constructor(private readonly deps: { readonly whatsAppConfig: WhatsAppConfigRepository }) {}

  async execute(input: ConnectWhatsAppInput): Promise<ConnectWhatsAppResult> {
    const existing = await this.deps.whatsAppConfig.findByChannelId(input.channelId);
    if (existing) {
      return { ok: false, reason: "channels.whatsapp_already_connected" };
    }

    // Trim once, up front, then validate and persist the SAME trimmed value throughout —
    // validating the untrimmed input would wrongly refuse a reference with only incidental
    // leading/trailing whitespace (e.g. pasted from a form field) even though the value
    // itself is perfectly valid once trimmed.
    const credentialSecretRef = input.credentialSecretRef.trim();
    const webhookVerifySecretRef = input.webhookVerifySecretRef.trim();
    if (
      !isValidSecretReference(credentialSecretRef) ||
      !isValidSecretReference(webhookVerifySecretRef)
    ) {
      return { ok: false, reason: "channels.secret_ref_invalid" };
    }

    const config = await this.deps.whatsAppConfig.create({
      channelId: input.channelId,
      phoneNumber: input.phoneNumber.trim(),
      phoneNumberId: input.phoneNumberId.trim(),
      wabaId: input.wabaId.trim(),
      optInRequired: input.optInRequired,
      credentialSecretRef,
      webhookVerifySecretRef,
      now: input.now,
    });
    return { ok: true, config };
  }
}
