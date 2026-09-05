import { Module } from '@nestjs/common';
import { LIVEKIT_CLIENT } from './domain/ports';
import { LiveKitClientAdapter } from './infrastructure/livekit-client.adapter';

/**
 * Transport bounded context (FR-TRANSPORT-1/3, LLD §8.3). Pure LiveKit
 * capability — room lifecycle, token mint/verify, explicit agent dispatch,
 * webhook verification. Deliberately has no `application`/`interface` layer
 * of its own: every use case that needs LiveKit (in `sessions`/`public`/
 * `internal`) depends on `LIVEKIT_CLIENT` through this module's barrel, the
 * same "capability module" shape `RedisModule`/`PrismaService` already use.
 */
@Module({
  providers: [{ provide: LIVEKIT_CLIENT, useClass: LiveKitClientAdapter }],
  exports: [LIVEKIT_CLIENT],
})
export class TransportModule {}
