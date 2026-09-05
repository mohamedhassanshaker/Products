import type { TenantContext } from "@nextbot/db";
import type {
  BulkImportConsentRequest,
  ConnectMetaBusinessAccountRequest,
  CreateWebWidgetChannelRequest,
  RecordConsentRequest,
  SetWabaConfigRequest,
} from "@nextbot/contracts";
import { createWebWidgetChannel } from "../application/create-web-widget-channel.js";
import { listChannels, setChannelAgentDefinitionBinding } from "../infrastructure/channel-repository.js";
import { createWhatsAppChannel, activateWhatsAppChannel, whatsAppChannelReadiness } from "../application/create-whatsapp-channel.js";
import {
  connectMetaBusinessAccount,
  disconnectMetaBusinessAccount,
  getMetaBusinessAccountDto,
  setWabaConfig,
} from "../application/connect-meta-business-account.js";
import { syncWhatsAppNumbers, listWhatsAppNumberDtos, rotateSystemUserToken, rotateAppSecret } from "../application/whatsapp-config-service.js";
import { syncWhatsAppTemplates, listWhatsAppTemplateDtos } from "../application/whatsapp-template-service.js";
import { listConsentRecordDtos, recordConsent, bulkImportConsent, dryRunBulkImportConsent } from "../application/whatsapp-consent-service.js";

/**
 * `http/` layer (LLD §2.2): plain `(ctx, input) => output` functions, no RBAC check
 * inside — `channels` cannot depend on `iam` (allow-list is `channels -> tenancy`
 * only). `requirePermission(...)` for the `channels` RBAC module happens at the
 * composition root (`apps/web/app/api/v1/admin/channels/**\/route.ts`).
 */

export async function handleListChannels(ctx: TenantContext) {
  return listChannels(ctx);
}

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2, LLD §15.7) — the
 * Channels screen's "Answered by" selector.
 *
 * `agentDefinitionId: null` is an explicitly settable value (unbind → fall back to the
 * tenant-wide lookup), not an omission. RBAC (`channels=Write`) is applied at the
 * composition root, per this file's own convention — `channels` cannot depend on `iam`.
 */
export async function handleSetChannelAgentBinding(ctx: TenantContext, channelId: string, agentDefinitionId: string | null) {
  await setChannelAgentDefinitionBinding(ctx, channelId, agentDefinitionId);
  return { channelId, agentDefinitionId };
}

export async function handleCreateWebWidgetChannel(ctx: TenantContext, input: CreateWebWidgetChannelRequest) {
  return createWebWidgetChannel(ctx, input);
}

export async function handleCreateWhatsAppChannel(ctx: TenantContext, input: CreateWebWidgetChannelRequest) {
  return createWhatsAppChannel(ctx, input);
}

export async function handleWhatsAppChannelReadiness(ctx: TenantContext, channelId: string) {
  return whatsAppChannelReadiness(ctx, channelId);
}

export async function handleActivateWhatsAppChannel(ctx: TenantContext, channelId: string) {
  return activateWhatsAppChannel(ctx, channelId);
}

export async function handleConnectMetaBusinessAccount(ctx: TenantContext, input: ConnectMetaBusinessAccountRequest) {
  return connectMetaBusinessAccount(ctx, input);
}

export async function handleDisconnectMetaBusinessAccount(ctx: TenantContext, channelId: string) {
  return disconnectMetaBusinessAccount(ctx, channelId);
}

export async function handleGetMetaBusinessAccount(ctx: TenantContext, channelId: string) {
  return getMetaBusinessAccountDto(ctx, channelId);
}

export async function handleSetWabaConfig(ctx: TenantContext, channelId: string, input: SetWabaConfigRequest) {
  return setWabaConfig(ctx, channelId, input);
}

export async function handleSyncWhatsAppNumbers(ctx: TenantContext, channelId: string) {
  return syncWhatsAppNumbers(ctx, channelId);
}

export async function handleListWhatsAppNumbers(ctx: TenantContext, channelId: string) {
  return listWhatsAppNumberDtos(ctx, channelId);
}

export async function handleRotateSystemUserToken(ctx: TenantContext, channelId: string, newToken: string) {
  return rotateSystemUserToken(ctx, channelId, newToken);
}

export async function handleRotateAppSecret(ctx: TenantContext, channelId: string, newSecret: string) {
  return rotateAppSecret(ctx, channelId, newSecret);
}

export async function handleSyncWhatsAppTemplates(ctx: TenantContext, channelId: string) {
  return syncWhatsAppTemplates(ctx, channelId);
}

export async function handleListWhatsAppTemplates(ctx: TenantContext, channelId: string) {
  return listWhatsAppTemplateDtos(ctx, channelId);
}

export async function handleListConsentRecords(ctx: TenantContext, channelId: string) {
  return listConsentRecordDtos(ctx, channelId);
}

export async function handleRecordConsent(ctx: TenantContext, channelId: string, input: RecordConsentRequest) {
  return recordConsent(ctx, channelId, input);
}

export async function handleDryRunBulkImportConsent(_ctx: TenantContext, input: BulkImportConsentRequest) {
  return dryRunBulkImportConsent(input);
}

export async function handleBulkImportConsent(ctx: TenantContext, channelId: string, input: BulkImportConsentRequest, importedByUserId: string | null) {
  return bulkImportConsent(ctx, channelId, input, importedByUserId);
}
