import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/**
 * SHJ3 lint configuration.
 *
 * Beyond ordinary correctness rules, this file mechanically enforces two
 * architectural decisions that are otherwise unenforceable:
 *
 *  1. **Module boundaries** (architecture.md §3). A feature module may not
 *     import another feature module. Cross-feature work goes through a published
 *     port or a domain event. `governance` and `iam` are cross-cutting;
 *     `platform` is the substrate and depends on nothing.
 *
 *  2. **The swap test** (architecture.md §4). `domain/` and `application/`
 *     contain zero vendor imports — no Prisma, no Neo4j, no Qdrant, no Redis, no
 *     OpenAI, no Next.js. Grep those layers for a vendor name and the answer
 *     must be empty. This is what makes replacing Qdrant with pgvector, or
 *     OpenRouter with Bedrock, a change to one adapter rather than a change to
 *     business logic.
 *
 * Both are review-blocking rules, so they are checks rather than conventions.
 */

const FEATURE_MODULES = [
  "conversation",
  "agents",
  "orchestration",
  "tools",
  "knowledge",
  "flows",
  "handover",
  "channels",
  "verification",
  "payments",
  "evaluation",
  "analytics",
  "theming",
  "userguide",
  // Screen 3 (Guardrails & policies, 2026-09-10) — the GLOBAL policy catalogue admin
  // view. A new sibling module rather than an extension of `governance` (crosscutting):
  // "the global policy catalogue" is its own bounded concern, distinct from
  // environments/promotions/audit/observability/privacy, and depends on nothing besides
  // `platform` — see the module's own README-equivalent doc comments for the full
  // placement reasoning.
  "guardrails",
];

/**
 * Packages that must never appear in domain or application code. The list is
 * the vendor surface of every port in `api.md` §9 — if a new adapter is added
 * for a new vendor, its package belongs here.
 */
const VENDOR_PACKAGES = [
  "@prisma/client",
  "prisma",
  "neo4j-driver",
  "@qdrant/js-client-rest",
  "redis",
  "ioredis",
  "openai",
  "cohere-ai",
  "@anthropic-ai/sdk",
  "litellm",
  "next",
  "next/*",
  "react",
  "react-dom",
  // Observability (architecture.md §10, deployment.md §13.1). Tracing wiring belongs in
  // modules/platform/observability/ and the adapters that call it — never in domain or
  // application, which must stay ignorant of *how* a trace id was produced.
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/resources",
  "@opentelemetry/semantic-conventions",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "apps/ai/**",
      "prisma/generated/**",
      "docs/**",
      // B-6: `esbuild`'s minified IIFE output for the embeddable widget
      // (`apps/web/scripts/build-widget-embed.ts` regenerates this from real,
      // already-linted source at `apps/web/src/widget-embed/main.ts`) — a
      // build artifact, not authored code, same reasoning as
      // `prisma/generated/**` above.
      "apps/web/public/embed/**",
      // Next.js regenerates this on every build/dev start; its triple-slash
      // reference is Next's own required form, not ours to fix.
      "**/next-env.d.ts",
      // `playwright.config.ts`'s own reporters regenerate these on every
      // `pnpm exec playwright test` run — `playwright-report/` bundles
      // Playwright's own pre-built, already-minified trace-viewer JS
      // (found live: a bare `eslint .`/`verify.mjs --staged` run right after
      // an E2E pass reported ~10,000 errors, all inside this vendored
      // bundle, none in real source), and `test-results/`/`reports/` hold
      // per-run screenshots, traces and the JSON results file `docs/
      // testing.md` §1 wants machine-readable — none of it authored code,
      // same reasoning as `apps/web/public/embed/**` above.
      "playwright-report/**",
      "test-results/**",
      "reports/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ------------------------------------------------------------------ base ---
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // TypeScript resolves identifiers itself, and does it correctly for DOM,
      // Node and library globals. Leaving `no-undef` on for TS files produces
      // false positives on types and never catches anything tsc would miss.
      "no-undef": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-param-reassign": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        // No underscore-prefix escape for unused variables: the project's rule is
        // to delete dead code rather than rename it out of the way.
        { args: "all", argsIgnorePattern: "^$", varsIgnorePattern: "^$" },
      ],
      "@typescript-eslint/no-floating-promises": "off", // needs type info; enabled in the typed block below
    },
  },

  // ------------------------------------------- the swap test (§4 layering) ---
  {
    files: [
      "apps/web/src/modules/*/domain/**/*.{ts,tsx}",
      "apps/web/src/modules/*/application/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: VENDOR_PACKAGES.filter((p) => !p.endsWith("/*")).map((name) => ({
            name,
            message:
              "Vendor imports are forbidden in domain/ and application/. Depend on a port and put the SDK in adapters/outbound/ (architecture.md §4).",
          })),
          patterns: [
            {
              group: ["next/*", "**/adapters/**"],
              message:
                "domain/ and application/ must not reach into adapters or the framework. Invert the dependency with a port (architecture.md §4).",
            },
          ],
        },
      ],
    },
  },

  // domain/ is the innermost layer: it may not even import its own module's
  // ports or application layer.
  {
    files: ["apps/web/src/modules/*/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ports/**", "**/application/**", "**/adapters/**"],
              message:
                "domain/ depends on nothing outside domain/. Pure business logic only (architecture.md §4).",
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------- module boundaries ---
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      // Without a TypeScript-aware resolver, every NodeNext import specifier
      // (which carries a ".js" extension pointing at a ".ts" source) resolves
      // to nothing, the plugin classifies the target as "unknown", and the
      // element-types rule silently passes on everything. A boundary rule that
      // never fires is worse than no rule, so this setting is load-bearing.
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: ["apps/web/tsconfig.json", "packages/*/tsconfig.json"],
        },
      },
      "boundaries/include": ["apps/web/src/**/*"],
      "boundaries/elements": [
        { type: "platform", pattern: "apps/web/src/modules/platform/**" },
        {
          type: "crosscutting",
          pattern: "apps/web/src/modules/(governance|iam)/**",
          capture: ["module"],
        },
        {
          type: "feature",
          pattern: `apps/web/src/modules/(${FEATURE_MODULES.join("|")})/**`,
          capture: ["module"],
        },
        { type: "app", pattern: "apps/web/src/app/**" },
        { type: "shared", pattern: "apps/web/src/shared/**" },
        // Pure, presentational component library (design-system.md §5.1):
        // atoms/molecules in components/ui/, organisms in components/patterns/.
        // Tailwind + Radix + React only — no backend/domain dependency.
        { type: "components", pattern: "apps/web/src/components/**" },
      ],
    },
    rules: {
      "boundaries/no-unknown-files": "off",
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // The substrate depends on nothing.
            { from: ["platform"], allow: ["platform", "shared"] },

            // Cross-cutting concerns may use the substrate, never a feature — with one
            // narrow, explicitly product-decided exception: B-9's `governance` module
            // (promotions, B14 tab 1) depends on `evaluation`'s `PublishGateChecker` port
            // (`modules/evaluation/ports/publish-gate-checker.ts`) to check/record a
            // publish gate evaluation before a promotion into the live environment can be
            // inserted — the real DB trigger (`TR_PromotionRequests_decisionRules`)
            // requires a persisted `GateEvaluations` row either way, so this dependency
            // mirrors a real, already-decided data relationship rather than loosening the
            // architecture generally. Scoped to the `evaluation` module by name, not a
            // blanket "crosscutting may use any feature" allowance.
            {
              from: ["crosscutting"],
              allow: [
                "platform",
                "crosscutting",
                "shared",
                "components",
                ["feature", { module: "evaluation" }],
              ],
            },

            // A feature may use the substrate and the cross-cutting modules,
            // and itself — but NOT a sibling feature. Cross-feature work goes
            // through a published port or a domain event.
            {
              from: ["feature"],
              allow: [
                "platform",
                "crosscutting",
                "shared",
                "components",
                ["feature", { module: "${from.module}" }],
              ],
            },

            // Route handlers and pages compose everything.
            {
              from: ["app"],
              allow: ["platform", "crosscutting", "feature", "shared", "app", "components"],
            },

            // Pure presentational layer: itself and shared utilities only. No
            // backend/domain dependency (design-system.md §5.1) — a component
            // that reaches into platform/feature/crosscutting code stops being
            // swappable independently of the app that consumes it.
            { from: ["components"], allow: ["components", "shared"] },

            { from: ["shared"], allow: ["shared"] },
          ],
        },
      ],
    },
  },

  // --------------------------------------------------------------- tests ---
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/tests/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // Isolation tests deliberately construct raw clients to assert, from
      // outside the application, that tenant A's data is unreachable as tenant
      // B. That attempt is the assertion.
      "no-restricted-imports": "off",
      "boundaries/element-types": "off",
    },
  },

  // ------------------------------------------------------------- scripts ---
  {
    files: ["scripts/**/*.mjs", "*.config.mjs", "*.config.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // ---------------------------------------------------------------- a11y ---
  // WCAG 2.1 AA is a base-component requirement, not a retrofit (design-
  // system.md §5.1, §10.6). jsx-a11y's `recommended` preset is what gives
  // `jsx-a11y/tabindex-no-positive` (§10.3, §12.2's positive-tabindex ban)
  // essentially for free, plus the rest of its static a11y coverage — alt
  // text, aria-* validity, label association, interactive role/handler
  // pairing — over the one place JSX is actually authored in this repo.
  // Scoped rather than global because jsx-a11y's rules assume JSX, and
  // `apps/web/src/**` is the only tree that contains any.
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["apps/web/src/**/*.{ts,tsx}"],
  },
);
