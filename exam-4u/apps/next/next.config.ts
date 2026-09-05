import type { NextConfig } from 'next';

/**
 * ExamLand's Next.js config.
 *
 * `output: 'standalone'` (migration plan, HLD §13.1-equivalent for the new stack): produces a
 * self-contained `.next/standalone` server bundle with only the production dependencies actually
 * traced from the app's imports, which is what `apps/next/Dockerfile`'s runtime stage copies —
 * mirrors the legacy Dockerfile's "single image, minimal runtime footprint" goal without needing a
 * separate `npm ci --omit=dev` pass inside the Next.js build stage.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  // `pino` spawns its `pino-roll`/`pino/file` transports in a `worker_threads` worker, resolving the
  // target module path at runtime (not via a statically-visible `require()` call). Two failure modes
  // were found and fixed here by actually running the built Docker image (not just `next build`)
  // during Phase 0 (docs/plans/nextjs-rewrite-phase0-plan.md):
  //
  // 1. Webpack bundling `pino`/`pino-roll` into `.next/server/chunks/**` breaks pino's own internal
  //    worker-thread bootstrap (it computes a path *relative to its own file location*, which is no
  //    longer valid once bundled) — `serverExternalPackages` tells Next to `require()` these two
  //    packages directly from `node_modules` at runtime instead of bundling them.
  // 2. `output: 'standalone'`'s file-tracer can't see the dynamic (IPC-message-passed) transport
  //    require either, so it silently omits `pino-roll` from the copied `node_modules` —
  //    `outputFileTracingIncludes` force-includes it regardless of static traceability.
  // `pdf-parse`/`pdfjs-dist` (`server/infrastructure/text-extraction/pdf-text-extractor.ts`) hit the
  // IDENTICAL class of bug as `pino`/`pino-roll` above, found only by actually running a real
  // `next start` server (Phase 8 closure verification, `docs/plans/nextjs-rewrite-phase8-plan.md`):
  // `pdfjs-dist` sets up its Node "fake worker" via its own internal dynamic `import('pdf.worker.mjs')`,
  // resolved *relative to its own file's location on disk* — once webpack bundles that file into
  // `.next/server/chunks/**`, the relative path no longer points at a real file, and every real PDF
  // upload's background extraction step fails with `Setting up fake worker failed: Cannot find module
  // '.../chunks/pdf.worker.mjs'`, durably landing the session at `Failed`/`INTERNAL_ERROR` instead of
  // ever reaching extraction/classification. `docs/plans/nextjs-rewrite-phase6-plan.md`'s own
  // environment-fragility note only verified `pdf-parse` against `vitest` (real Node module execution,
  // never webpack-bundled) — this is a genuinely different, previously-unexercised code path (a real
  // `next build`/`next start` bundle), not a re-run of that same, already-documented finding.
  serverExternalPackages: ['pino', 'pino-roll', 'pdf-parse', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    // `date-fns` is `pino-roll`'s own transitive dependency (used for its `dateFormat` option) —
    // hoisted to the monorepo root's `node_modules` (not nested under `apps/next`'s), so it needs
    // the `../../` relative path to be found from `apps/next`'s own tracing root. Omitting this
    // (verified in Phase 0) fails at container boot with `Cannot find module 'date-fns'`.
    '/api/**': [
      './node_modules/pino-roll/**',
      './node_modules/pino/**',
      '../../node_modules/date-fns/**',
    ],
  },
};

export default nextConfig;
