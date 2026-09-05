import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for `apps/next`'s pure-logic unit tests (migration plan's "Per-phase verification"
 * step 4: "Unit tests scoped to that phase's own new pure-logic code only"). No project-wide test
 * framework existed yet for the new stack (the legacy app uses Jest, which is NestJS-shaped and not
 * reused here) — Vitest is the standard choice for a Next.js/ESM/TypeScript app.
 *
 * Phase 2 sub-slice "2a" extends `include` to `.test.tsx` (this app's first UI-bearing phase — every
 * prior test file was `src/server/**`, pure Node/`.test.ts`) and adds `environmentMatchGlobs` so those
 * new `.tsx` component tests run under `jsdom` (React Testing Library needs a DOM) while every
 * existing `.test.ts` file keeps running under the faster, already-proven `node` environment —
 * scoped narrowly rather than flipping the whole suite to `jsdom` (which would slow down and add an
 * unnecessary DOM dependency to the ~350 pre-existing server-side tests that never touch one).
 */
export default defineConfig({
  // Vitest's default esbuild-based transform needs an explicit `jsx: 'automatic'` to compile
  // `.tsx` files against React 19's automatic JSX runtime (no `import React` needed per file) —
  // `tsconfig.json`'s own `"jsx": "preserve"` is Next.js's own setting (its SWC/webpack pipeline
  // handles the transform itself) and isn't read by Vitest's separate esbuild transform, so this
  // needs its own explicit setting here rather than being inherited. Found by actually running the
  // new `.tsx` component tests this dispatch adds (`ReferenceError: React is not defined`), not
  // assumed from documentation.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Phase 2 sub-slice "2a" extends coverage to this dispatch's new client-side data-access layer
      // (`lib/platform-console/**`) and its two logic-bearing shared components (`status-badge.tsx`,
      // `confirm-dialog.tsx`, both unit-tested this dispatch). Whole *pages*
      // (`app/platform/**/page.tsx`, `platform-shell.tsx`) are deliberately left uncovered here, same
      // precedent this project already established for `app/api/**` Route Handlers (thin,
      // orchestration-only, proven via a real HTTP/browser pass rather than vitest coverage) — see
      // `docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made".
      include: [
        'src/server/**/*.ts',
        'src/lib/platform-console/**/*.ts',
        'src/lib/tenant-console/**/*.ts',
        'src/components/platform/status-badge.tsx',
        'src/components/platform/confirm-dialog.tsx',
        // Phase 9 sub-slice "9a" — `accent-scale.ts` is pure shade-ramp derivation logic (no React/DOM),
        // unit-tested directly, matching this same "logic-bearing non-page file" precedent above.
        'src/components/theme/accent-scale.ts',
      ],
      exclude: ['src/server/**/*.test.ts', 'src/lib/platform-console/**/*.test.ts', 'src/lib/tenant-console/**/*.test.ts'],
    },
  },
});
