/**
 * Bundles `src/widget-embed/main.ts` into `public/embed/widget.js` — the
 * real, standalone `<script>` a third-party page embeds (see that file's
 * own module comment for why it is a fully self-contained, dependency-light
 * bundle with no import from the rest of this app).
 *
 * Run via `pnpm run build:widget` (composed into `pnpm run build`, so a
 * production build always produces a fresh bundle) or directly with `tsx
 * scripts/build-widget-embed.ts` for a quick local rebuild while iterating
 * on the widget itself.
 *
 * `esbuild`, not `tsc`: this bundle is not part of the Next.js
 * build/module-graph at all (a standalone IIFE for a `<script>` tag, not an
 * ES module some other file imports), so it needs its own bundler entry
 * point rather than piggybacking on `next build`'s own webpack/Turbopack
 * pipeline, which has no notion of "also emit this one unrelated static
 * asset." `tsc --noEmit` (the project's own `typecheck` script) still
 * type-checks `widget-embed/main.ts` for real, since it lives under `src/`
 * and the app's `tsconfig.json` includes all of `src` — this script is only
 * responsible for *emitting* the runnable bundle, not for verifying its
 * types.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entryPoint = join(here, "..", "src", "widget-embed", "main.ts");
const outfile = join(here, "..", "public", "embed", "widget.js");

async function main(): Promise<void> {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    minify: true,
    sourcemap: true,
    // IIFE, not ESM: this is loaded via a plain `<script>` tag on a
    // third-party host page that has no reason to support module scripts,
    // and an IIFE keeps every internal symbol out of the host page's global
    // scope (the module comment's Shadow DOM isolation argument, applied to
    // JS scope as well as CSS).
    format: "iife",
    target: ["es2020"],
    // Every consuming browser is unknown in advance (a citizen's own
    // device), so target broad, real-world support rather than this
    // monorepo's own Node/tsconfig target.
    logLevel: "info",
  });
  console.info(`[build-widget-embed] wrote ${outfile}`);
}

main().catch((error: unknown) => {
  console.error("[build-widget-embed] failed", error);
  process.exitCode = 1;
});
