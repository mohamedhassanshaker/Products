import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global module exposing the single, application-wide `PrismaService`
 * instance (and its underlying connection pool) to every feature module.
 *
 * F-1 fix (QA Phase 6, routed to nexus-dev): previously `PrismaService` was
 * declared directly in `AppModule`'s (and `InternalAppModule`'s) own
 * `providers` array with no dedicated exporting module. Per NestJS's
 * module-scoping rules a provider declared only in a module's own
 * `providers` array is visible only inside that module — it is NOT
 * automatically available to descendant modules unless they import a module
 * that exports it. Every feature module that injects `PrismaService`
 * directly (tenants, auth, admin-users, providers, deployment-config,
 * sessions) never imported anything exporting it, so `NestFactory.create`
 * threw `UnknownDependenciesException` at real boot time — a defect that was
 * invisible to every prior QA pass because Jest's
 * `Test.createTestingModule({...})` supplies `PrismaService` directly
 * alongside the module under test, bypassing the real module tree's DI
 * boundary entirely.
 *
 * `@Global()` makes this module's exports available to every module in the
 * application graph once `PrismaModule` is imported anywhere (here, once
 * each in `AppModule` and `InternalAppModule`, since those are two
 * independent Nest applications with two independent DI containers) —
 * without requiring every feature module to import `PrismaModule` itself or
 * re-declare `PrismaService` locally, which would create a second,
 * independently-pooled instance instead of sharing the one connection pool.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
