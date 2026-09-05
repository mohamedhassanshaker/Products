/**
 * Next.js's `register()` boot hook (stable since Next 15, runs exactly once per server process
 * before any request is handled — https://nextjs.org/docs/app/guides/instrumentation). This is
 * where env validation actually happens "on boot" rather than lazily on first use: without this
 * hook, `getEnv()`'s first call would be whichever request handler happens to run first, which
 * doesn't reliably fail the *process* before it starts accepting traffic (migration plan item 4:
 * "validates on boot, fails fast... same spirit as the original" — the legacy NestJS app's
 * `ConfigModule` does this synchronously during `NestFactory.create()`, before the HTTP listener
 * opens; this hook is the Next.js equivalent).
 *
 * Guarded to the Node.js runtime only — Next.js also invokes `register()` for the Edge runtime
 * (`NEXT_RUNTIME === 'edge'`) when middleware exists, which this app does not use in Phase 0, and
 * `server/config`/`server/logging` both use Node-only APIs (`node:fs`) that don't exist on Edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { getEnv } = await import('@/server/config');
      const env = getEnv(); // throws synchronously, listing every violation, on invalid config.

      const { logger } = await import('@/server/logging');
      logger.info({ nodeEnv: env.NODE_ENV }, 'boot.env_validated');

      // Phase 1 sub-slice 1b: idempotent Platform Admin bootstrap (this app's equivalent of legacy's
      // `PlatformAdminBootstrapService`'s `OnApplicationBootstrap` lifecycle hook — see that class's
      // own doc comment). Deliberately runs *after* env validation logs above, and is itself wrapped
      // so a bootstrap failure (e.g. platform DB briefly unreachable at cold start) doesn't prevent
      // the process from serving traffic — unlike an invalid env, a bootstrap failure is retryable
      // (the next boot/restart tries again; the table being briefly empty is not a crash-worthy
      // condition the way a missing required secret is).
      try {
        const { runPlatformAdminBootstrap } = await import('@/server/platform/auth');
        await runPlatformAdminBootstrap();
      } catch (bootstrapErr) {
        logger.error({ err: bootstrapErr }, 'boot.platform_admin_bootstrap_failed');
      }
    } catch (err) {
      // Verified in Phase 0 (docs/plans/nextjs-rewrite-phase0-plan.md): Next.js's own handling of a
      // `register()` rejection logs an `unhandledRejection` but does NOT terminate the process — the
      // HTTP listener has already bound by the time this hook's promise settles, so every request
      // would otherwise get a generic 500 forever with no clear signal *why*. An explicit
      // `process.exit(1)` here, after writing the real reason to stderr, makes an invalid
      // configuration a genuine boot failure (crash-loops visibly under any container orchestrator's
      // restart policy) instead of a silently-degraded, always-500 "zombie" process — matching
      // `env.schema.ts`'s own "the process never finishes booting with an invalid configuration"
      // contract literally, not just in the unit-test sense.
      process.stderr.write(`[boot] ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  }
}
