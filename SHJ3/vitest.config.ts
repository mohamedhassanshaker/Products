import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Test projects, matching the layers in `docs/testing.md`.
 *
 * The split is not cosmetic — each project has a different contract about what
 * it may touch, and keeping them separate is what lets `unit` stay fast enough
 * to run in a pre-commit hook while `isolation` runs against real containers.
 *
 *   unit         Domain and application layers. No I/O, no store, no network.
 *                Fast because those layers hold zero vendor imports by design
 *                (architecture.md §4), which is what makes them unit-testable.
 *
 *   integration  Adapters against REAL stores in containers. Deliberately not
 *                mocked: a mocked store passing while the real schema is broken
 *                is the classic failure this project cannot afford, given two
 *                ORMs share one database (ADR-0005).
 *
 *   isolation    The tenant-isolation suite. A release gate under ADR-0002 —
 *                proves a principal scoped to one government entity cannot
 *                read, write, retrieve, embed or cache against another, across
 *                all four stores, including forged-tenant payloads. Requires at
 *                least two provisioned tenants, which is why the Compose
 *                environment seeds two.
 *
 *   contract     The internal API between shj3-web and shj3-ai. Load-bearing
 *                because ADR-0001 made that hop a network boundary, so a type
 *                error there is a runtime failure rather than a compile failure.
 *
 * Model providers are stubbed in every project. A non-deterministic LLM cannot
 * be an assertion target; model *quality* is measured by a separate,
 * explicitly non-blocking evaluation suite (testing.md).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["apps/web/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Scoped here rather than at the root: a top-level `esbuild` option
        // does not propagate into inline `test.projects[]` entries (verified
        // directly — the smoke test below still failed with "React is not
        // defined" after adding it at the root, so it moved here instead).
        // `jsx: "automatic"` auto-imports from `react/jsx-runtime` so test
        // files never need `import React` just to use JSX. No
        // `@vitejs/plugin-react` dependency needed — that plugin is for dev-time
        // Fast Refresh, not the base JSX transform vitest's esbuild pipeline needs.
        esbuild: {
          jsx: "automatic",
        },
        // Same "scoped here, not at the root" lesson as `esbuild` above,
        // applied to path resolution: Vite/Vitest does not read `tsconfig.json`
        // `paths` on its own (that mapping is TypeScript- and Next.js-only), so
        // every component under test importing the project's one canonical
        // `cn()` helper via `@/lib/utils` (components.json's `utils` alias,
        // apps/web/tsconfig.json's `paths`) failed to resolve at all until this
        // was added — confirmed directly, not assumed (a bare component render
        // test failed with "Failed to resolve import '@/lib/utils'" before this
        // was in place). `resolve.alias` is Vite's own mechanism and is the
        // correct fix rather than switching component source to relative
        // imports, which would leave production code (where the tsconfig path
        // *does* apply) inconsistent with test-only code for no reason.
        resolve: {
          alias: {
            "@": resolve(import.meta.dirname, "apps/web/src"),
          },
        },
        test: {
          // JSX-rendering tests for the component library (design-system.md §5),
          // kept strictly separate from `unit` by extension (`.test.tsx` vs
          // `.test.ts`) rather than widening `unit`'s pattern: domain/application
          // tests stay fast with zero DOM, component tests get jsdom — mixing the
          // two would slow down the pre-commit-hook-fast `unit` project for every
          // contributor, not just component authors.
          name: "components",
          include: ["apps/web/src/components/**/*.test.tsx"],
          environment: "jsdom",
          // jest-dom matchers and jest-axe's toHaveNoViolations, registered once
          // here rather than per test file (apps/web/vitest.setup.ts).
          setupFiles: ["apps/web/vitest.setup.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.spec.ts"],
          environment: "node",
          // Real containers are slow to reach; a 30s default avoids flakes that
          // get blamed on the code.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Integration tests share containers, so parallel files race on
          // schema state. Correctness over speed here.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "isolation",
          include: ["tests/isolation/**/*.spec.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 90_000,
          fileParallelism: false,
          // Provisions sewa/customs across all four real stores exactly once for the whole
          // project run (not per spec file — Vitest's default file isolation means a
          // module-level flag in a per-file beforeAll would not survive between files).
          // See tests/isolation/setup.ts for the fixture logic this wraps.
          globalSetup: ["tests/isolation/global-setup.ts"],
        },
      },
      {
        test: {
          name: "contract",
          include: ["tests/contract/**/*.spec.ts"],
          environment: "node",
          testTimeout: 20_000,
        },
      },
    ],
  },
});
