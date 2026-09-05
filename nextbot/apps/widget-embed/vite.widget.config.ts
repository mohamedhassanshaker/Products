import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the iframe-hosted widget SPA (React + Tailwind/shadcn + Zustand) — the
 * actual launcher/window/message UI. Entirely independent of `apps/web`'s Next.js
 * build: its own React tree, its own CSS custom-property theme instance (never the
 * Admin Console's), so there is no risk of the admin theme leaking into the widget
 * just because both happen to live in the same monorepo (Plan Phase 5,
 * `docs/plans/chakra-to-shadcn-plan.md`, superseding ADR-0002 §4.2a's Chakra-era
 * description — see ADR-0010).
 *
 * Output (`dist-widget/`) is a standalone static site — `index.html` + hashed
 * asset bundle — that any static file server (incl. `apps/web`'s `public/`
 * directory, copied in at deploy time) can serve verbatim.
 *
 * **D2/D3 fix (QA fix pass):** the source entrypoint is `index.html` (renamed from
 * `widget.html` — Vite names its build output HTML file after the input file it
 * was built from, so a source file literally called `widget.html` produced
 * `dist-widget/widget.html`, which never matched `nextbot-loader.ts`'s hardcoded
 * `${base}index.html` request — every real embed 404'd on the iframe's very first
 * request). `base: "./"` makes every asset reference in that HTML (the JS bundle,
 * any hashed chunk) a path *relative to the HTML file itself* rather than Vite's
 * default absolute `/assets/...`, which breaks the moment this build is deployed
 * under a subpath (`.../widget/index.html`, per the loader's own doc comment)
 * instead of a domain root.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist-widget",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.html",
    },
  },
});
