#!/usr/bin/env node
/**
 * Generate the Tailwind v4 theme bridge from `@shj3/tokens`.
 *
 * ADR-0007 / design-system.md §3.4: Tailwind utility classes must compile to
 * `var(--token)`, never a literal, so a runtime theme change (per-tenant
 * branding, light/dark, density) repaints every `bg-primary`/`p-4`/`rounded-md`
 * with no rebuild. Tailwind v4 resolves `@theme` blocks from CSS text at build
 * time, so that bridge has to be a committed file — this script is the thin
 * I/O wrapper around `generateTailwindThemeCss` (`packages/tokens/src/tailwind-theme.ts`),
 * which does the actual derivation from the token package's own name-list
 * exports. Mirrors `scripts/generate-python-models.mjs`: the package owns the
 * generation logic, this script owns the "generated file" banner and the write.
 *
 * `scripts/gates/tailwind-theme-drift.mjs` re-runs this and fails the commit on
 * a non-empty diff — the same defence `prisma-sqlalchemy-drift.mjs` gives the
 * other generated file in this repository.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateTailwindThemeCss } from "@shj3/tokens";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_PATH = resolve(ROOT, "apps/web/src/styles/tailwind-theme.generated.css");

const banner = [
  "/*",
  " * SHJ3 Tailwind v4 theme bridge — GENERATED FILE, DO NOT EDIT.",
  " *",
  " * Generated from @shj3/tokens by scripts/generate-tailwind-theme.mjs, which",
  " * calls generateTailwindThemeCss() (packages/tokens/src/tailwind-theme.ts).",
  " * Editing this file by hand will be reverted by the next generation, and",
  " * scripts/gates/tailwind-theme-drift.mjs will fail the commit. To change a",
  " * Tailwind-facing token name or add a new one, edit the token package's",
  " * semantic.ts / components.ts and the generator, then re-run",
  " * `pnpm tokens:tailwind`.",
  " *",
  " * design-system.md §3.4, ADR-0007.",
  " */",
  "",
].join("\n");

const body = generateTailwindThemeCss();

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, banner + body, "utf8");

console.log(`Generated Tailwind theme bridge → ${OUT_PATH.slice(ROOT.length + 1)}`);
