/** Public API of the transport module. */
export { TransportModule } from './transport.module';
export { LIVEKIT_CLIENT } from './domain/ports';
export type {
  LiveKitClientPort,
  RoomTokenGrant,
  CreateRoomOutcome,
  VerifiedRoomToken,
  LiveKitWebhookEvent,
} from './domain/ports';
export {
  buildRoomName,
  userIdentity,
  agentIdentity,
  tokenTtlSeconds,
  DEFAULT_AGENT_NAME,
  DEFAULT_MAX_DURATION_SECONDS,
} from './domain/room';
