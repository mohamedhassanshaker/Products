import { defineConfig } from "vite";
import path from "node:path";

/**
 * Builds `nextbot.js` — the tiny, dependency-free vanilla-JS loader a host page
 * includes via `<script src=".../nextbot.js"></script>` (screen inventory A.3.1's
 * `NextBot.init({...})`). It never imports React/Chakra/Zustand — its only job is
 * to validate the embed config, inject a single iframe pointed at the widget SPA
 * (`vite.widget.config.ts`'s build), and relay resize/position postMessages from
 * that iframe (LLD §1/§5.3, `docs/design/UX_GUIDELINES.md` §5.1's iframe-boundary
 * note). IIFE output so a host page's own bundler/module system is irrelevant.
 */
export default defineConfig({
  build: {
    outDir: "dist-loader",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/loader/nextbot-loader.ts"),
      name: "NextBotLoader",
      formats: ["iife"],
      fileName: () => "nextbot.js",
    },
    rollupOptions: {
      output: {
        // The loader deliberately has no runtime dependencies to bundle, but this
        // guards against one being added by accident without a matching ADR review.
      },
    },
  },
});
