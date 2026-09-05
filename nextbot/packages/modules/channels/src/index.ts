// PUBLIC API for @nextbot/channels (LLD §2.2, BL-04, BL-15).
export { generateChannelPublicKey } from "./domain/public-key.js";
export { createWebWidgetChannel } from "./application/create-web-widget-channel.js";
export { resolveWidgetChannel } from "./application/resolve-widget-channel.js";
export {
  findChannelById,
  findChannelByPublicKey,
  findChannelByName,
  listChannels,
  updateChannelStatus,
  // Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2) — the channel→agent
  // definition binding: the hot per-turn read `apps/gateway` makes before calling
  // `resolveTurnAgentVersion`, and the admin write behind the Channels screen's
  // "Answered by" selector.
  findAgentDefinitionIdForChannel,
  setChannelAgentDefinitionBinding,
  type ChannelRow,
} from "./infrastructure/channel-repository.js";
export { getChannelCapability } from "./infrastructure/channel-capability-repository.js";

// BL-15 (WhatsApp slice)
export { createWhatsAppChannel, activateWhatsAppChannel, whatsAppChannelReadiness, WhatsAppChannelNotReadyError } from "./application/create-whatsapp-channel.js";
export {
  connectMetaBusinessAccount,
  disconnectMetaBusinessAccount,
  getMetaBusinessAccountDto,
  setWabaConfig,
  markMetaBusinessAccountUnreachable,
  markMetaBusinessAccountConnected,
} from "./application/connect-meta-business-account.js";
export {
  resolveSystemUserToken,
  resolveAppSecret,
  resolveWebhookVerifyToken,
  rotateSystemUserToken,
  rotateAppSecret,
  syncWhatsAppNumbers,
  listWhatsAppNumberDtos,
} from "./application/whatsapp-config-service.js";
export { syncWhatsAppTemplates, listWhatsAppTemplateDtos } from "./application/whatsapp-template-service.js";
export {
  getWebhookStatusDto,
  reverifyWebhookChallenge,
  markWhatsAppWebhookVerified,
  markWhatsAppWebhookVerificationFailed,
  markWhatsAppWebhookEventReceived,
} from "./application/whatsapp-webhook-service.js";
export {
  listConsentRecordDtos,
  recordConsent,
  bulkImportConsent,
  dryRunBulkImportConsent,
  exportConsentRecordsCsv,
  maskPhoneNumber,
} from "./application/whatsapp-consent-service.js";
export { findMetaBusinessAccountByChannelId, listConsentRecords, findApprovedTemplateByName, findWhatsAppNumberByPhoneNumberId } from "./infrastructure/whatsapp-repository.js";

export {
  handleListChannels,
  handleCreateWebWidgetChannel,
  // Phase 17 (BL-48, ADR-0019 §2.2) — the "Answered by" agent-definition binding.
  handleSetChannelAgentBinding,
  handleCreateWhatsAppChannel,
  handleWhatsAppChannelReadiness,
  handleActivateWhatsAppChannel,
  handleConnectMetaBusinessAccount,
  handleDisconnectMetaBusinessAccount,
  handleGetMetaBusinessAccount,
  handleSetWabaConfig,
  handleSyncWhatsAppNumbers,
  handleListWhatsAppNumbers,
  handleRotateSystemUserToken,
  handleRotateAppSecret,
  handleSyncWhatsAppTemplates,
  handleListWhatsAppTemplates,
  handleListConsentRecords,
  handleRecordConsent,
  handleDryRunBulkImportConsent,
  handleBulkImportConsent,
} from "./http/admin-routes.js";
