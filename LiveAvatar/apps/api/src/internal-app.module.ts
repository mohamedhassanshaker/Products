import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { AppExceptionFilter } from './common/errors/app-exception.filter';
import { createFailSafeFileDestination } from './common/logging/file-logger';
import { PINO_REDACT_PATHS } from './common/logging/pino-redact-paths';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { InternalModule } from './modules/internal';

/**
 * Root module for the internal listener (`:8081`, LLD §5.1/§5.9). A second,
 * independent Nest application rather than a second HTTP adapter bolted onto
 * the public app — NestJS has no first-class "one app, two ports" API, and
 * keeping the internal surface a genuinely separate application is also
 * what makes NFR-3's "internal heartbeat/tool URLs not exposed on the public
 * conversation origin" trivially true (they are never registered on the
 * public app's router at all, not just firewalled).
 *
 * Deliberately does NOT import `AdminUsersModule`/`AuthModule`/etc — only
 * what `/internal` routes need (`InternalModule`, which itself pulls in
 * `sessions`/`transport`/`providers`).
 *
 * `PrismaModule` and `RedisModule` are each imported explicitly here even
 * though both are `@Global()`: this is a second, independent Nest
 * application (its own `NestFactory.create` call, its own DI container), so
 * a `@Global()` module imported only into `AppModule`'s graph is invisible
 * here — the same defect class as F-1 (QA Phase 6), caught live-booting this
 * process: `SessionsModule` pulls in `ProvidersModule`, whose
 * `RedisProbeRateLimiter` injects `REDIS_CLIENT`, which was unavailable
 * until `RedisModule` was imported directly into this module too.
 *
 * Wires the same Pino logger + redaction denylist the public app uses (QA
 * Phase 3 D-3): this process hosts `LiveKitClientAdapter`'s own DI instance
 * and is exactly where its raw SDK error payloads are most likely to surface
 * in a log line, so the "LiveKit secrets never logged" guarantee must hold
 * here too, not only on the public `:8080` app.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        redact: PINO_REDACT_PATHS,
        stream: pino.multistream([
          { stream: process.stdout },
          { stream: createFailSafeFileDestination(process.env.LOG_DIR ?? './logs') },
        ]),
      },
    }),
    PrismaModule,
    RedisModule,
    InternalModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
})
export class InternalAppModule {}
