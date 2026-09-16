import { describe, expect, it } from "vitest";
import { ConnectWhatsApp } from "./connect-whatsapp.js";
import type {
  CreateWhatsAppConfigInput,
  WhatsAppConfigRepository,
  WhatsAppConfigRow,
} from "../ports/whatsapp-config-repository.js";

function fakeWhatsAppConfig(
  existing: WhatsAppConfigRow | null,
): WhatsAppConfigRepository & { created: CreateWhatsAppConfigInput[] } {
  const created: CreateWhatsAppConfigInput[] = [];
  return {
    created,
    async findByChannelId() {
      return existing;
    },
    async findByPhoneNumberId() {
      return null;
    },
    async create(input) {
      created.push(input);
      return {
        id: "wac_new",
        channelId: input.channelId,
        phoneNumber: input.phoneNumber,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        bspProvider: "MetaCloudApi",
        optInRequired: input.optInRequired,
        sessionWindowHours: 24,
        credentialSecretRef: input.credentialSecretRef,
        webhookVerifySecretRef: input.webhookVerifySecretRef,
      };
    },
    async update() {
      throw new Error("not used in this test");
    },
  };
}

const BASE_INPUT = {
  channelId: "chan_wa_01",
  phoneNumber: "+971501234567",
  phoneNumberId: "1234567890",
  wabaId: "9876543210",
  optInRequired: true,
  credentialSecretRef: "env:SEWA_WHATSAPP_TOKEN",
  webhookVerifySecretRef: "env:SEWA_WHATSAPP_WEBHOOK_VERIFY",
  now: new Date("2026-09-10T00:00:00.000Z"),
};

describe("ConnectWhatsApp", () => {
  it("refuses when the channel already has a WhatsAppConfig row", async () => {
    const whatsAppConfig = fakeWhatsAppConfig({
      id: "wac_existing",
      channelId: "chan_wa_01",
      phoneNumber: "+971500000000",
      phoneNumberId: "old",
      wabaId: "old",
      bspProvider: "MetaCloudApi",
      optInRequired: true,
      sessionWindowHours: 24,
      credentialSecretRef: "env:OLD",
      webhookVerifySecretRef: "env:OLD_VERIFY",
    });
    const useCase = new ConnectWhatsApp({ whatsAppConfig });

    const result = await useCase.execute(BASE_INPUT);

    expect(result).toEqual({ ok: false, reason: "channels.whatsapp_already_connected" });
    expect(whatsAppConfig.created).toHaveLength(0);
  });

  it("refuses a credential reference that is not env:/k8s:/vault:-prefixed", async () => {
    const whatsAppConfig = fakeWhatsAppConfig(null);
    const useCase = new ConnectWhatsApp({ whatsAppConfig });

    const result = await useCase.execute({
      ...BASE_INPUT,
      credentialSecretRef: "sk_live_real_looking_secret",
    });

    expect(result).toEqual({ ok: false, reason: "channels.secret_ref_invalid" });
    expect(whatsAppConfig.created).toHaveLength(0);
  });

  it("refuses a webhook verify reference that is not env:/k8s:/vault:-prefixed", async () => {
    const whatsAppConfig = fakeWhatsAppConfig(null);
    const useCase = new ConnectWhatsApp({ whatsAppConfig });

    const result = await useCase.execute({ ...BASE_INPUT, webhookVerifySecretRef: "plaintext" });

    expect(result).toEqual({ ok: false, reason: "channels.secret_ref_invalid" });
    expect(whatsAppConfig.created).toHaveLength(0);
  });

  it("creates a real WhatsAppConfig row, pinning bspProvider and sessionWindowHours", async () => {
    const whatsAppConfig = fakeWhatsAppConfig(null);
    const useCase = new ConnectWhatsApp({ whatsAppConfig });

    const result = await useCase.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.config.bspProvider).toBe("MetaCloudApi");
    expect(result.config.sessionWindowHours).toBe(24);
    expect(whatsAppConfig.created).toHaveLength(1);
    expect(whatsAppConfig.created[0]).toMatchObject({
      channelId: "chan_wa_01",
      phoneNumber: "+971501234567",
      phoneNumberId: "1234567890",
      wabaId: "9876543210",
      optInRequired: true,
      credentialSecretRef: "env:SEWA_WHATSAPP_TOKEN",
      webhookVerifySecretRef: "env:SEWA_WHATSAPP_WEBHOOK_VERIFY",
    });
  });

  it("trims surrounding whitespace before persisting", async () => {
    const whatsAppConfig = fakeWhatsAppConfig(null);
    const useCase = new ConnectWhatsApp({ whatsAppConfig });

    await useCase.execute({
      ...BASE_INPUT,
      phoneNumber: "  +971501234567  ",
      credentialSecretRef: "  env:SEWA_WHATSAPP_TOKEN  ",
    });

    expect(whatsAppConfig.created[0]?.phoneNumber).toBe("+971501234567");
    expect(whatsAppConfig.created[0]?.credentialSecretRef).toBe("env:SEWA_WHATSAPP_TOKEN");
  });
});
