import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Load the monorepo-root `.env`, not `apps/web/.env` (which does not exist — the real
 * `.env` lives at the repo root, alongside every other workspace package). `next dev`/
 * `next build`/`next start` only auto-load a `.env` from *this* package's own directory
 * (Next's documented, Next-specific convention) — a real, systemic gap this wave found by
 * actually driving a signed-in request through `next dev` for the first time (every
 * earlier route's own `next dev` check happened to need no real `SHJ3_SQL_URL`/
 * `SHJ3_REDIS_URL` access, since none of them had a bound `TenantContext` yet to reach
 * one with — see `next-request-context.ts`'s own module comment). Every other tool in
 * this repo (`tsx scripts/*.ts`, `vitest`) already resolves the root `.env` correctly;
 * this is what makes `next dev`/`next build`/`next start` see the identical values rather
 * than silently running with none. `process.loadEnvFile` is Node's own built-in (20.6+,
 * no dependency needed) — guarded by `existsSync` so a deployed environment that injects
 * real environment variables directly (K8s secrets/config maps, deployment.md §16) and
 * carries no `.env` file at all is unaffected, not broken by a missing-file throw.
 */
const ROOT_ENV_PATH = resolve(import.meta.dirname, "../../.env");
if (existsSync(ROOT_ENV_PATH)) {
  process.loadEnvFile(ROOT_ENV_PATH);
}

/**
 * Mirrors `PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER`
 * (`src/modules/theming/domain/prefers-dark.ts`) — kept as a literal here rather than
 * imported, confirmed necessary by a real failed build: Next's config-file loader
 * (`next/dist/build/next-config-ts/transpile-config.js`) transpiles `next.config.ts`
 * through its own pathway, separate from the `webpack()` hook below (which only
 * patches *application* bundling) — it does not apply the NodeNext `.js`-to-`.ts`
 * extension-alias resolution this repo's own imports rely on everywhere else, so
 * `import { X } from "./src/modules/.../prefers-dark.js"` here throws
 * `MODULE_NOT_FOUND` at config-load time, before webpack ever runs. Two definitions
 * of one small, stable HTTP header name is a smaller risk than a config file that
 * cannot load.
 */
const PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER = "sec-ch-prefers-color-scheme";

/**
 * `transpilePackages` is required because `@shj3/tokens` (and future
 * workspace packages) ship TypeScript source rather than a pre-built
 * `dist/`, per this monorepo's pnpm workspace layout — Next.js only
 * transpiles its own app code and node_modules packages with a "module"
 * export by default.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@shj3/tokens"],
  /**
   * Next's own default Server Action request-body cap is 1 MB — the EXACT same
   * number as `CK_BrandAssets_byteSize`'s own 1 MiB ceiling (`MAX_BRAND_ASSET_
   * BYTES`, `modules/theming/domain/brand-asset.ts`), with zero headroom for the
   * `FormData` multipart envelope (boundary markers, field names, headers) a real
   * browser adds around the file bytes. Found live: uploading a file at exactly
   * this wave's own size cap produced a generic, unhelpful Next-level rejection
   * instead of `UploadBrandAsset`'s own clear "too large" message — the two caps
   * need real headroom between them so the APPLICATION's cap is always the one
   * that actually fires. `4mb` leaves comfortable room above the 1 MiB image cap
   * for multipart overhead on any current or near-future upload this app adds,
   * without meaningfully weakening the real limit (`UploadBrandAsset.execute()`
   * still rejects anything over 1 MiB on its own, server-side, regardless of what
   * this transport-level ceiling allows through).
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  /**
   * A `next build` limitation was found and investigated while adding this wave's
   * `/settings/appearance/reset` Server Action — see the full account in
   * `app/[locale]/settings/appearance/reset/actions.ts`'s own doc comment, including
   * why `outputFileTracingExcludes` (tried here, pointed at `prisma/generated/**`)
   * did NOT fix it and was removed again rather than left as dead, misleading
   * configuration. Not resolved by any config-only change found; documented as a
   * real, environment-specific gap rather than hidden.
   */
  /**
   * Two independent theming-related header concerns on every response, design-
   * system.md §9.4:
   *
   *  1. `Accept-CH`/`Critical-CH` advertise the `Sec-CH-Prefers-Color-Scheme` Client
   *     Hint so supporting (Chromium-family) browsers start sending it on every
   *     subsequent request — `resolveTheme()`'s real signal for `mode: "system"`
   *     (`modules/theming/domain/prefers-dark.ts`'s own doc comment explains why
   *     this exists instead of the aspirational `principal.prefersDark` the design
   *     doc describes, and what a non-supporting browser falls back to).
   *     `Critical-CH` additionally tells a supporting browser to retry the *very
   *     first* navigation once it has seen this header — the closest this
   *     mechanism gets to working on a true first visit.
   *  2. `Cache-Control: private` plus a `Vary` naming both the client hint AND
   *     `Cookie` is §9.4's own explicit requirement: "the resolved theme is
   *     inlined server-side and never fetched client-side... `Cache-Control:
   *     private` on every page carrying an inlined theme; `Vary` on the tenant-
   *     bearing session cookie." This is what stops a shared/CDN cache from ever
   *     serving one tenant's or user's resolved theme to a different one — the
   *     inlining alone stops a *client-side* leak, this stops a *cache-side* one.
   *     Verified directly against a real dev response: for the actual themed pages
   *     (which read `cookies()`/`headers()` in the root layout and are therefore
   *     dynamically rendered), Next.js's own automatic Cache-Control for dynamic
   *     rendering — `no-store, must-revalidate` — takes precedence over this
   *     header and is stricter than what §9.4 asks for (no caching at all beats
   *     "cache privately"), and Next's own computed `Vary` (RSC payload variance)
   *     similarly wins over the value set here rather than combining with it. This
   *     header is therefore the explicit, defence-in-depth statement of intent and
   *     the effective setting for anything NOT dynamically rendered (e.g. `/api/
   *     healthz`); it is not redundant with Next's default, since that default only
   *     exists because this layout reads request-scoped data, and disappears the
   *     moment it doesn't.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Accept-CH", value: PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER },
          { key: "Critical-CH", value: PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER },
          { key: "Vary", value: `${PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER}, Cookie` },
          { key: "Cache-Control", value: "private" },
        ],
      },
    ];
  },
  eslint: {
    // Linting is `pnpm verify`'s job, against the repo-root flat config that
    // already covers this app (module boundaries, the swap test, the token
    // gates). Next's own build-time lint step runs a *different*,
    // partially-configured ESLint pass — it references rules like
    // `react/no-danger` from a plugin this repo does not load, which fails
    // the build on nothing our own gate would ever flag. One lint pass, one
    // meaning of "clean" (ADR-0008's single-verification-command intent).
    ignoreDuringBuilds: true,
  },
  webpack(config) {
    // `tsconfig.base.json` targets NodeNext everywhere in this repo (root
    // README/CLAUDE.md rule: ".js" extensions on relative imports of ".ts"
    // sources — see instrumentation.ts, css.ts, every module import in
    // apps/web/src/modules/**). tsc resolves that pattern natively; Next's
    // webpack build does not, by default, so a plain `next build` fails on
    // the very first ".js" specifier it tries to bundle with "Module not
    // found". `resolve.extensionAlias` is webpack's own documented mechanism
    // for exactly this case — teach it to also try ".ts"/".tsx" for any
    // specifier written with ".js". Without this, `next build` cannot
    // succeed for any file in this codebase, which is unrelated to any one
    // feature; it belongs here rather than in a per-file workaround.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

/**
 * next-intl requires this wrapper even though `src/i18n/request.ts` sits at
 * its own auto-detected default path (verified by reading the plugin's
 * source, `plugin/getNextConfig.js`: it searches exactly `./i18n/request.*`
 * and `./src/i18n/request.*`, so no explicit path argument is needed here).
 * The wrapper isn't optional convenience — it's the only place a
 * `next-intl/config` webpack/Turbopack resolve alias pointing at that file
 * gets set up. Without it, `next-intl/config` resolves to the package's own
 * placeholder module, which unconditionally throws "Couldn't find next-intl
 * config file" — confirmed directly, not assumed: that is the exact error
 * `next build` produced before this wrapper was added.
 *
 * It chains cleanly with the custom `webpack()` above rather than replacing
 * it — the plugin's own webpack function calls `nextConfig.webpack(...)` if
 * one is already present (same source file), so the NodeNext extension-alias
 * patch still runs.
 */
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
