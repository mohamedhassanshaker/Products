// PUBLIC API for "@nextbot/channel-adapters" (LLD §8).
export type {
  ChannelAdapter,
  ChannelCapability,
  ChannelDto,
  GenericMessagePayload,
  InboundEvent,
  InboundEventKind,
  OutboundPayload,
  RawRequest,
  SendReceipt,
  ValidationResult,
  WhatsAppSendCredentials,
} from "./port.js";
export { getChannelAdapter, ChannelAdapterNotImplementedError } from "./registry.js";
export { whatsAppAdapter, isWithinSessionWindow, WHATSAPP_SESSION_WINDOW_HOURS, type WhatsAppSendOptions } from "./whatsapp/adapter.js";
export { verifyMetaSignature } from "./whatsapp/signature.js";
export {
  createMetaGraphClient,
  MetaGraphTransportError,
  type MetaGraphClient,
  type MetaGraphClientOptions,
  type MetaBusinessInfo,
  type MetaPhoneNumber,
  type MetaMessageTemplate,
} from "./whatsapp/meta-graph-client.js";
