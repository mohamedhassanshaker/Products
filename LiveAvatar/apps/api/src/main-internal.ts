import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import express from 'express';
import { InternalAppModule } from './internal-app.module';

/**
 * Boots the internal listener (`:8081`, LLD §5.1/§5.9). Phase 1 shipped this
 * as a raw-Express 404 stub; Phase 3 (BL-010) replaces it with a real, if
 * intentionally narrow, Nest application exposing only the LiveKit webhook
 * route this phase's session lifecycle needs (`InternalModule`). Later
 * phases add agent-facing routes to the same module without touching this
 * bootstrap.
 *
 * `express.raw()` is registered ahead of Nest's own body parsing, scoped to
 * the webhook path only, so `req.body` is the exact byte sequence LiveKit
 * signed — JSON-parsing and re-serializing it (Nest's default pipeline)
 * would invalidate the webhook signature.
 */
async function bootstrapInternal(): Promise<void> {
  const app = await NestFactory.create(InternalAppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use('/internal/livekit/webhooks', express.raw({ type: '*/*' }));

  // Defense in depth (QA Phase 3 D-1): the root cause (a missing `await` on
  // `WebhookReceiver.receive()`) is fixed in `LiveKitClientAdapter`, but this
  // process is meant to be a durable, cluster-reachable listener hosting
  // agent-facing routes from Phase 4 onward, so a single global safety net
  // guarantees a future unhandled rejection anywhere in this app logs and
  // survives rather than crashing the process (Node 15+ terminates on an
  // unhandled rejection by default when no handler is installed).
  process.on('unhandledRejection', (reason: unknown) => {
    app.get(Logger).error({ err: reason }, 'Unhandled rejection in internal app (survived, not crashing)');
  });

  const port = Number(process.env.INTERNAL_PORT ?? 8081);
  await app.listen(port);
}

bootstrapInternal().catch((err: unknown) => {
  console.error('Fatal error during internal bootstrap', err);
  process.exit(1);
});
