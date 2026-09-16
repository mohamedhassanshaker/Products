#!/usr/bin/env node
/**
 * Gate: the generated Tailwind theme bridge matches `@shj3/tokens`.
 *
 * ADR-0007 / design-system.md §3.4. `apps/web/src/styles/tailwind-theme.generated.css`
 * is committed output, not hand-written CSS — it exists so Tailwind v4 can read
 * the `@theme` mapping at build time, but its content is derived entirely from
 * `packages/tokens/src/tailwind-theme.ts`. The only thing that keeps the two
 * from drifting apart is this gate: it re-runs the same generator this file was
 * produced by and refuses a commit where the committed output differs from what
 * the generator now produces.
 *
 * Same pattern as `scripts/gates/prisma-sqlalchemy-drift.mjs` for the generated
 * SQLAlchemy models: one owner (here, the token package), one generated
 * consumer, one gate that fails loudly on a bypassed regeneration rather than
 * letting a token rename or addition silently stop compiling into a Tailwind
 * utility.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { report } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const GENERATED = resolve(ROOT, "apps/web/src/styles/tailwind-theme.generated.css");

const before = existsSync(GENERATED) ? readFileSync(GENERATED, "utf8") : null;

const proc = spawnSync("node", ["scripts/generate-tailwind-theme.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (proc.status !== 0) {
  console.error("\n  FAIL gate:tailwind-theme-drift — the generator itself failed\n");
  console.error(proc.stdout ?? "");
  console.error(proc.stderr ?? "");
  console.error(
    "  The generator is build-critical: apps/web cannot compile Tailwind utilities\n" +
      "  without its output. Fix it before committing.\n",
  );
  process.exit(1);
}

const after = readFileSync(GENERATED, "utf8");

if (before === null) {
  process.exit(
    report({
      gate: "tailwind-theme-drift",
      rule: "The generated Tailwind theme bridge must be committed alongside the token package (ADR-0007)",
      findings: [
        {
          file: "apps/web/src/styles/tailwind-theme.generated.css",
          line: 1,
          excerpt: "(file was missing and has now been generated)",
          note: "Stage the generated file with your token change",
        },
      ],
      hint: "The generated file is part of the commit, not a build artefact. `git add` it.",
    }),
  );
}

if (before !== after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const findings = [];
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length) && findings.length < 8; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      findings.push({
        file: "apps/web/src/styles/tailwind-theme.generated.css",
        line: i + 1,
        excerpt: `committed: ${beforeLines[i] ?? "(end of file)"}`,
        note: `regenerated: ${afterLines[i] ?? "(end of file)"}`,
      });
    }
  }

  process.exit(
    report({
      gate: "tailwind-theme-drift",
      rule: "The committed Tailwind theme bridge must equal the generator's current output (ADR-0007, design-system.md §3.4)",
      findings,
      hint:
        "The generator has already rewritten the file — review the change and stage it.\n" +
        "  Do not hand-edit the generated file: edit packages/tokens/src/tailwind-theme.ts\n" +
        "  (or the semantic.ts / components.ts tables it reads from) instead, then run\n" +
        "  `pnpm tokens:tailwind`.",
    }),
  );
}

console.log("  ok   tailwind-theme-drift");
process.exit(0);
