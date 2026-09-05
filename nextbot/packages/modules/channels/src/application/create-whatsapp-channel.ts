import { randomBytes } from "node:crypto";
import { ChannelNameDuplicateError, ChannelNotFoundError, type CreateWebWidgetChannelRequest } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { findChannelByName, findChannelById, insertChannel, type ChannelRow } from "../infrastructure/channel-repository.js";
import { updateChannelStatus } from "../infrastructure/channel-repository.js";
import { findMetaBusinessAccountByChannelId } from "../infrastructure/whatsapp-repository.js";

/**
 * Creates the `WhatsApp` channel shell (FR-OC-03's "Add Channel" wizard, WhatsApp
 * type). Starts `Inactive` (FR-OC-03: "a wizard cannot be completed... until all
 * required fields for that channel type pass validation") — becomes eligible for
 * `activateWhatsAppChannel` once a Meta Business Manager account is linked and a
 * WABA ID is set (see `whatsAppChannelReadiness` below).
 */
export async function createWhatsAppChannel(ctx: TenantContext, input: CreateWebWidgetChannelRequest): Promise<ChannelRow> {
  const existing = await findChannelByName(ctx, input.environment, input.name);
  if (existing) throw new ChannelNameDuplicateError(input.name);

  const publicKey = `wa_${randomBytes(16).toString("hex")}`;
  const id = await insertChannel(ctx, {
    type: "WhatsApp",
    name: input.name,
    environment: input.environment,
    config: {},
    publicKey,
    status: "Inactive",
  });

  return (await findChannelById(ctx, id)) as ChannelRow;
}

export interface WhatsAppChannelReadiness {
  ready: boolean;
  reasons: string[];
}

/** FR-OC-03: "no 'Activate' action available" until every required field for this
 * channel type validates — the concrete WhatsApp readiness gate: a Meta Business
 * Manager account must be linked (`Connected` status) and a WABA ID set. */
export async function whatsAppChannelReadiness(ctx: TenantContext, channelId: string): Promise<WhatsAppChannelReadiness> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  const reasons: string[] = [];
  if (!account) reasons.push("Connect a Meta Business Manager account.");
  else {
    if (account.status !== "Connected") reasons.push("Meta Business Manager connection is not healthy.");
    if (!account.wabaId) reasons.push("Set a WABA ID.");
  }
  return { ready: reasons.length === 0, reasons };
}

export async function activateWhatsAppChannel(ctx: TenantContext, channelId: string): Promise<ChannelRow> {
  const channel = await findChannelById(ctx, channelId);
  if (!channel || channel.type !== "WhatsApp") throw new ChannelNotFoundError();

  const readiness = await whatsAppChannelReadiness(ctx, channelId);
  if (!readiness.ready) {
    throw new WhatsAppChannelNotReadyError(readiness.reasons);
  }
  await updateChannelStatus(ctx, channelId, "Active");
  return (await findChannelById(ctx, channelId)) as ChannelRow;
}

export class WhatsAppChannelNotReadyError extends Error {
  constructor(readonly reasons: string[]) {
    super(`WhatsApp channel is not ready to activate: ${reasons.join(" ")}`);
    this.name = "WhatsAppChannelNotReadyError";
  }
}
