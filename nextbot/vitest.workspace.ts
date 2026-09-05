import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkspace } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest workspace definition.
 *
 * Three logical projects, matched by nexus-dev's operating instructions and the
 * plan's exit gates:
 *   - "unit"        — pure logic, fakes/mocks only, no real DB/HTTP. Runs everywhere, always fast.
 *   - "integration"  — exercises real (test) Postgres/Redis via compose.test.yml. Slower, run in CI
 *                       and locally when the test stack is up.
 *   - "isolation"    — the tenant-isolation / RLS-safety suite (LLD §3.2): cross-tenant reads must
 *                       return zero rows, and every migration adding a tenant-scoped table must carry
 *                       FORCE ROW LEVEL SECURITY + a policy.
 *
 * Every package selects which of its test files belong to which project via the
 * naming convention `*.test.ts` (unit, default), `*.int.test.ts` (integration),
 * `*.isolation.test.ts` (isolation).
 */
export default defineWorkspace([
  {
    // QA-driven fix pass (this dispatch): `apps/web`'s own `tsconfig.json` sets
    // `"jsx": "preserve"` (required so Next.js's own compiler does the JSX
    // transform at build time) — but esbuild (what Vitest/Vite use to transform
    // .tsx under test) doesn't understand "preserve" and silently falls back to
    // the *classic* `React.createElement` transform, which throws
    // `ReferenceError: React is not defined` in any `apps/web/**/*.test.tsx` file
    // that (correctly, per `packages/ui`'s own convention) never imports React
    // itself. Forcing the automatic runtime here at the Vite/esbuild level
    // (independent of any single package's tsconfig) fixes it without touching
    // `apps/web/tsconfig.json` — which must keep `"preserve"` for Next's own build.
    esbuild: { jsx: "automatic" },
    // `apps/web/tsconfig.json` maps the `@/*` specifier to its own package root
    // (Next.js resolves this natively at build time) — Vite/Vitest has no built-in
    // tsconfig-paths awareness, so `apps/web/**/*.test.ts(x)` files importing e.g.
    // `@/src/lib/session` would otherwise fail to resolve entirely under `vitest`.
    // Scoped to this one alias/target; no other package in the workspace uses a
    // `@/` specifier, so this can't shadow anything elsewhere.
    //
    // Final Review DEFECT-2 investigation (2026-09-01): `resolve.dedupe: ["react",
    // "react-dom"]` was tried here as the standard Vitest remedy for "Invalid hook
    // call" (see https://vitest.dev/guide/common-errors). It was REVERTED — empirically
    // confirmed to be actively harmful in this repo's specific layout, not a fix: with
    // strict pnpm (no hoisting) and no `react`/`react-dom` dependency declared at the
    // WORKSPACE ROOT (only leaf packages like `apps/web` depend on it), `dedupe` makes
    // Vite resolve the deduped package starting from Vite's config root — which has no
    // `node_modules/react` at all — and every `apps/web`/`apps/widget-embed`/
    // `packages/ui` React test file then fails with "Failed to resolve import
    // react/jsx-dev-runtime" (reproduced: 102/328 unit files failed the moment this
    // was added, 0 when removed). See this file's own doc comment for the full
    // DEFECT-2 write-up in `docs/NEXUS_STATE.md`'s decision log — six independent full
    // fresh runs of the unit project (default `threads` pool ×2, `--pool=forks`,
    // `--pool=threads --poolOptions.threads.singleThread=true`, a cold
    // `node_modules/.vite` cache, and the literal `pnpm run test:unit` script) all
    // produced 328/328 files and 2298/2298 tests green with NO dedupe — so this
    // workspace does not need it, and adding it regresses the very suite it was meant
    // to protect.
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "apps/web"),
      },
    },
    test: {
      name: "unit",
      environment: "node",
      // Root-level `*.test.ts` (non-recursive) picks up repo-wide tooling regression
      // tests (e.g. eslint.boundaries.test.ts) that don't belong to any single
      // package, alongside the existing per-package unit test glob. `.test.tsx` was
      // added in the Phase 3 UI dispatch (packages/ui's first React component tests)
      // — each such file opts into jsdom via a per-file `// @vitest-environment
      // jsdom` pragma rather than switching this whole project's default environment.
      include: ["*.test.ts", "{apps,packages}/**/*.test.{ts,tsx}"],
      exclude: ["**/*.int.test.ts", "**/*.isolation.test.ts", "**/node_modules/**", "**/dist/**"],
      // Target Architecture Blueprint Phase 16 (BL-47b): raised from Vitest's implicit
      // 5s default, which had become a source of FALSE failures rather than a real
      // signal. Several `apps/web` route tests call `vi.mock(pkg, async (importOriginal)
      // => …)` — i.e. they deliberately load a REAL `@nextbot/*` module graph inside the
      // mock factory so the route exercises genuine sibling behaviour rather than a stub
      // (`tenant-branding/[slug]/route.test.ts` does this for `@nextbot/tenancy`'s real
      // WCAG contrast algorithm, and says so). That one-time ESM resolution can exceed
      // 5s on a loaded machine, and when it does the test times out with no assertion
      // having failed — which is why the failing FILE varied from run to run rather than
      // pointing at a defect.
      //
      // 20s is well under the integration/isolation projects' own 30s, and these are
      // pure-mock assertions with no latency semantics of their own, so nothing about
      // what they prove changes. A test that genuinely hangs still fails, just later.
      testTimeout: 20_000,
      // shadcn/Tailwind migration (Plan Phase 0): `@base-ui/react` primitives need
      // a real `PointerEvent` constructor, which jsdom doesn't implement — see
      // `vitest.setup.jsdom.ts`'s own doc comment. A no-op for the (majority)
      // node-environment unit tests that never touch `window`.
      setupFiles: ["./vitest.setup.jsdom.ts"],
    },
  },
  {
    // QA fix pass (retry 3, 2026-08-15): this project's first `apps/web/**/*.int.test.ts`
    // (the `bind-eval-suite` real-DB regression test) imports `@/src/lib/session` the
    // same way `apps/web`'s unit tests do — the `@/*` alias needs the same resolution
    // here as in the "unit" project above, or Vite/Vitest can't resolve it at all.
    // Scoped identically to the "unit" project's alias for the same reason (no other
    // package in the workspace uses a `@/` specifier).
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "apps/web"),
      },
    },
    test: {
      name: "integration",
      environment: "node",
      include: ["{apps,packages}/**/*.int.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      setupFiles: ["./vitest.setup.integration.ts"],
    },
  },
  {
    test: {
      name: "isolation",
      environment: "node",
      include: ["{apps,packages}/**/*.isolation.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      setupFiles: ["./vitest.setup.integration.ts"],
    },
  },
]);
