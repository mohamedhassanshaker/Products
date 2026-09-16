#!/usr/bin/env node
/**
 * `pnpm verify` — the single verification command.
 *
 * ADR-0008: no CI/CD was selected, so there is no pipeline whose green tick
 * defines "passing". This script *is* that definition. One command, one meaning
 * of green, so a reviewer never has to work out which subset of checks
 * constitutes a pass.
 *
 * It is deliberately written to be CI-ready: no prompts, no interactive steps,
 * deterministic ordering, and an exit code that means what it says. Adding a
 * pipeline later should be a YAML file that calls this, not a suite refactor —
 * that is the one thing ADR-0008 identified as expensive to retrofit, so it is
 * respected now.
 *
 * ## Stages
 *
 * Ordered cheapest-and-most-likely-to-fail first, so a broken commit fails in
 * seconds rather than minutes.
 *
 *   --staged   pre-commit: format, lint, typecheck, gates, unit tests
 *   (default)  the above plus integration, isolation and E2E
 *
 * The isolation suite is a release gate under ADR-0002 and runs in the full
 * pass, never skipped.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const staged = process.argv.includes("--staged");

const isWindows = process.platform === "win32";

/**
 * The Python toolchain lives in `apps/ai/.venv`.
 *
 * This script runs both sides rather than delegating the Python half to a
 * Makefile, because `make` is not present on Windows and the developer machines
 * here are Windows. A "single verification command" that only works on one
 * platform is two commands with extra steps — and the point of ADR-0008's
 * mitigation is that there is exactly one definition of green.
 *
 * The Makefile is kept for Unix convenience and for whenever CI is adopted, but
 * it is not the source of truth.
 */
const VENV = resolve(ROOT, "apps/ai/.venv");
const PY = isWindows ? resolve(VENV, "Scripts/python.exe") : resolve(VENV, "bin/python");
const LINT_IMPORTS = isWindows
  ? resolve(VENV, "Scripts/lint-imports.exe")
  : resolve(VENV, "bin/lint-imports");
const AI_DIR = resolve(ROOT, "apps/ai");

/** True when the Python environment has not been created yet (`make setup`). */
const noVenv = () => !existsSync(PY);

/** Stages. `optional` steps skip cleanly when their target does not exist yet. */
const STAGES = [
  {
    name: "format",
    cmd: "pnpm",
    args: ["exec", "prettier", "--check", "."],
    why: "Formatting is not a matter of taste here — a consistent tree keeps diffs reviewable.",
  },
  {
    name: "lint",
    cmd: "pnpm",
    args: ["exec", "eslint", ".", "--max-warnings=0"],
    why: "Includes the module-boundary rules and the vendor-import ban in domain/ and application/ (architecture.md §3, §4).",
  },
  {
    name: "typecheck",
    cmd: "pnpm",
    args: ["-r", "run", "typecheck"],
    why: "Types are the first line; a type error across the web↔ai hop is a runtime failure (ADR-0001).",
  },
  {
    name: "gate:secrets",
    cmd: "node",
    args: ["scripts/gates/no-secrets.mjs"],
    why: "CLAUDE.md: secrets never belong in code or docs — env/config only. With no CI, this is the only automated check before a credential lands in git history.",
  },
  {
    name: "gate:tokens",
    cmd: "node",
    args: ["scripts/gates/no-hardcoded-design-values.mjs"],
    why: "ADR-0007: without this, Phase E's runtime theming and per-tenant branding silently stop working.",
  },
  {
    name: "gate:cypher",
    cmd: "node",
    args: ["scripts/gates/no-raw-cypher.mjs"],
    why: "ADR-0009: the load-bearing control for graph tenant isolation. Neo4j Community has no DB-level fallback (RISK-024).",
  },
  {
    name: "gate:clients",
    cmd: "node",
    args: ["scripts/gates/no-unscoped-store-clients.mjs"],
    why: "ADR-0002 rule 3: a cross-tenant query must be unexpressible, not merely discouraged.",
  },
  {
    name: "gate:drift",
    cmd: "node",
    args: ["scripts/gates/prisma-sqlalchemy-drift.mjs"],
    why: "ADR-0005 rule 4: the only protection against two ORMs corrupting one schema (RISK-011).",
    // ADR-0011: the Prisma schema split into prisma/platform/ and prisma/tenant/ — either
    // being present means the schema is set up and the gate should run.
    optional: () =>
      !existsSync(resolve(ROOT, "prisma/platform/schema.prisma")) &&
      !existsSync(resolve(ROOT, "prisma/tenant/schema.prisma")),
  },
  {
    name: "gate:tailwind-theme",
    cmd: "node",
    args: ["scripts/gates/tailwind-theme-drift.mjs"],
    why: "ADR-0007: without this, a token rename or addition silently stops compiling into a Tailwind utility.",
  },
  {
    name: "gate:token-refs",
    cmd: "node",
    args: ["scripts/gates/no-undefined-token.mjs"],
    why: "ADR-0007 §12.3: an undefined token resolves to nothing — usually invisible text, not a visible error — and a primitive reference is a value a tenant skin can never re-point.",
  },
  {
    name: "gate:table",
    cmd: "node",
    args: ["scripts/gates/no-raw-table.mjs"],
    why: "design-system.md §5.5 #41: a hand-assembled <table> is how 14 divergent tables happen instead of one DataTable that solves sorting, empty states and RTL column order once.",
  },
  {
    name: "gate:i18n-strings",
    cmd: "node",
    args: ["scripts/gates/no-hardcoded-user-string.mjs"],
    why: "design-system.md §11.3/§12.3: a hardcoded string ships in one language forever, and an unisolated placeholder can silently reorder inside Arabic prose — neither fails loudly enough for review alone to reliably catch.",
  },
  {
    name: "gate:user-guide",
    cmd: "node",
    args: ["scripts/gates/user-guide-coverage.mjs"],
    why: "design-system.md §5.5 #56, Phase F's maintenance rule: a page with no guide entry (or a guide entry pointing at a deleted route) fails review — this is the mechanical half of that rule ADR-0008's no-CI environment can still enforce.",
  },
  {
    name: "test:unit",
    cmd: "pnpm",
    args: ["exec", "vitest", "run", "--project", "unit", "--passWithNoTests"],
    why: "Domain and application logic. No I/O, so failures here are logic failures.",
  },

  // ------------------------------- python (apps/ai) -----------------------
  // Same checks, other runtime. Two deployables, one gate (ADR-0001).
  {
    name: "py:format",
    cmd: PY,
    args: ["-m", "ruff", "format", "--check", "src", "tests"],
    cwd: AI_DIR,
    why: "Formatting parity with the TypeScript side.",
    optional: noVenv,
  },
  {
    name: "py:lint",
    cmd: PY,
    args: ["-m", "ruff", "check", "src", "tests"],
    cwd: AI_DIR,
    why: "Includes bandit security rules and the relative-import ban.",
    optional: noVenv,
  },
  {
    name: "py:types",
    cmd: PY,
    args: ["-m", "mypy", "src"],
    cwd: AI_DIR,
    why: "mypy --strict. The agent runtime's types are the first line on the web↔ai hop.",
    optional: noVenv,
  },
  {
    name: "py:arch",
    cmd: LINT_IMPORTS,
    args: [],
    cwd: AI_DIR,
    why: "import-linter: the layering contract and the swap test — domain and application hold zero vendor imports (architecture.md §4).",
    optional: () => !existsSync(LINT_IMPORTS),
  },
  {
    name: "py:test",
    cmd: PY,
    args: ["-m", "pytest", "tests", "-q", "-m", "not integration and not isolation"],
    cwd: AI_DIR,
    why: "Includes the Cypher builder's per-query-path isolation tests — the closest thing the graph has to an infrastructure guarantee (RISK-024).",
    optional: noVenv,
  },

  // ------------------------------- full pass only -------------------------
  {
    name: "test:integration",
    cmd: "pnpm",
    args: ["exec", "vitest", "run", "--project", "integration", "--passWithNoTests"],
    why: "Adapters against real stores in containers. A mocked store passing while the real schema is broken is the classic failure.",
    fullOnly: true,
  },
  {
    name: "test:isolation",
    cmd: "pnpm",
    args: ["exec", "vitest", "run", "--project", "isolation", "--passWithNoTests"],
    why: "ADR-0002 release gate. Proves tenant A cannot reach tenant B across all four stores, including forged-tenant payloads.",
    fullOnly: true,
  },
  {
    name: "test:e2e",
    cmd: "pnpm",
    args: ["exec", "playwright", "test"],
    why: "Both surfaces against the real running stack.",
    fullOnly: true,
    optional: () => !existsSync(resolve(ROOT, "playwright.config.ts")),
  },
];

const results = [];
let failed = false;

console.log("");
console.log(staged ? "SHJ3 verify — staged (pre-commit)" : "SHJ3 verify — full");
console.log("─".repeat(72));

for (const stage of STAGES) {
  if (staged && stage.fullOnly) continue;

  if (stage.optional?.()) {
    console.log(`  skip ${stage.name}  (target not present yet)`);
    results.push({ name: stage.name, status: "skipped" });
    continue;
  }

  const started = Date.now();
  const proc = spawnSync(stage.cmd, stage.args, {
    cwd: stage.cwd ?? ROOT,
    stdio: "inherit",
    // Only shell out for the commands that need PATH resolution (`pnpm`).
    // Absolute venv paths must not go through a shell, or Windows mangles the
    // spaces in the profile path.
    shell: isWindows && !stage.cmd.includes("\\") && !stage.cmd.includes("/"),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (proc.status === 0) {
    console.log(`  ok   ${stage.name}  (${seconds}s)`);
    results.push({ name: stage.name, status: "ok" });
  } else {
    console.error(`  FAIL ${stage.name}  (${seconds}s)`);
    console.error(`       ${stage.why}`);
    results.push({ name: stage.name, status: "failed", why: stage.why });
    failed = true;
    // Stop at the first failure. Fixing one thing often fixes the next, and a
    // wall of cascading errors is harder to act on than a single one.
    break;
  }
}

console.log("─".repeat(72));
const ok = results.filter((r) => r.status === "ok").length;
const skipped = results.filter((r) => r.status === "skipped").length;

if (failed) {
  const bad = results.find((r) => r.status === "failed");
  console.error(`FAILED at ${bad.name}. ${ok} passed, ${skipped} skipped.`);
  console.error("");
  console.error(
    "With no CI configured, this command is the only gate. Please fix rather than bypass.",
  );
  console.error("");
  process.exit(1);
}

console.log(`PASSED. ${ok} stage(s) ok, ${skipped} skipped.`);
console.log("");
process.exit(0);
