import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppExceptionFilter } from './common/errors/app-exception.filter';
import { TenantContextInterceptor } from './common/tenancy/tenant-context.interceptor';
import { IdempotencyInterceptor } from './common/http/idempotency.interceptor';
import { createFailSafeFileDestination } from './common/logging/file-logger';
import { PINO_REDACT_PATHS } from './common/logging/pino-redact-paths';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { PlatformModule } from './modules/platform';
import { AuthModule } from './modules/auth';
import { AdminUsersModule } from './modules/admin-users';
import { TenantsModule } from './modules/tenants';
import { ProvidersModule } from './modules/providers';
import { ToolsModule } from './modules/tools';
import { KnowledgeModule } from './modules/knowledge';
import { SkillsModule } from './modules/skills';
import { HitlModule } from './modules/hitl';
import { DeploymentConfigModule } from './modules/deployment-config';
import { TransportModule } from './modules/transport';
import { SessionsModule } from './modules/sessions';
import { PublicModule } from './modules/public';
import { JobsModule } from './modules/jobs';
import { SessionLogsModule } from './modules/session-logs';
import { DashboardModule } from './modules/dashboard';
import { GpuAdminModule } from './modules/gpu';
import { AlertsModule } from './modules/alerts';
import { ResidencyModule } from './modules/residency';

/**
 * Root module. Wires the shared kernel (errors, tenancy, idempotency,
 * logging) and every Phase 1 bounded context (platform, auth, admin-users,
 * tenants). Later phases add modules here without touching this file's shape.
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
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    // Serves the two compiled Angular SPAs (LLD §5.1: "dist/admin served at
    // /admin, dist/conversation served at /c, both with SPA fallback, by
    // @nestjs/serve-static"). `renderPath` defaults to serving each root's
    // own index.html for any unmatched GET under its `serveRoot`, which is
    // what makes client-side deep links (e.g. /admin/tenants/5) work on a
    // hard refresh instead of 404ing. Public listener (:8080) only — the
    // internal app (`InternalAppModule`, :8081) never imports this.
    // `nexus-deploy` builds the runtime image so `public/{admin,conversation}/browser`
    // sit next to `dist/` (see apps/api/Dockerfile).
    ServeStaticModule.forRoot(
      { rootPath: join(__dirname, '..', 'public', 'admin', 'browser'), serveRoot: '/admin' },
      { rootPath: join(__dirname, '..', 'public', 'conversation', 'browser'), serveRoot: '/c' },
    ),
    PrismaModule,
    RedisModule,
    PlatformModule,
    AuthModule,
    AdminUsersModule,
    TenantsModule,
    ProvidersModule,
    ToolsModule,
    KnowledgeModule,
    SkillsModule,
    HitlModule,
    DeploymentConfigModule,
    TransportModule,
    SessionsModule,
    PublicModule,
    JobsModule,
    SessionLogsModule,
    DashboardModule,
    GpuAdminModule,
    AlertsModule,
    ResidencyModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
