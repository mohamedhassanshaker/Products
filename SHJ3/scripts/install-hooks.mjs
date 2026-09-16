#!/usr/bin/env node
/**
 * Install SHJ3's pre-commit hook.
 *
 * ## Why this is a script rather than a `prepare` step
 *
 * SHJ3 is not the git root. The repository root is the parent `products`
 * directory, which also contains unrelated projects. A hook installed there
 * runs for **every** commit in that repository, including commits that have
 * nothing to do with SHJ3.
 *
 * Husky's `prepare` would have installed a hook silently on `pnpm install`,
 * which is the wrong default when the blast radius extends outside this project.
 * So installation is explicit — `pnpm hooks:install` — and the hook it writes is
 * path-filtered: it inspects the staged file list and exits immediately unless
 * something under `SHJ3/` is being committed.
 *
 * ## Why this matters more than usual here
 *
 * ADR-0008 records that no CI/CD was selected, which makes these hooks the only
 * enforcement that exists for:
 *
 *   - the Prisma → SQLAlchemy drift check, the sole protection against two ORMs
 *     corrupting one schema (ADR-0005 rule 4, RISK-011);
 *   - the no-raw-Cypher gate, the load-bearing control for graph tenant
 *     isolation now that Neo4j Community offers no database boundary and no
 *     RBAC (ADR-0009 rule 2, RISK-024);
 *   - the design-token gate, without which Phase E's runtime theming quietly
 *     stops working (ADR-0007).
 *
 * A `--no-verify` commit bypasses all three and nothing else catches it. That is
 * RISK-002, and it is why the hook is worth installing deliberately rather than
 * leaving to chance.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function git(...args) {
  return execFileSync("git", args, { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
}

let gitRoot;
try {
  gitRoot = git("rev-parse", "--show-toplevel");
} catch {
  console.error("Not inside a git repository — nothing to install.");
  process.exit(1);
}

// Path from the repository root down to this project, e.g. "SHJ3/".
const prefix = git("rev-parse", "--show-prefix") || "";
const projectPrefix = prefix.replace(/\/$/, "");

const hooksDir = join(gitRoot, ".git", "hooks");
const hookPath = join(hooksDir, "pre-commit");

const marker = "# >>> shj3 pre-commit >>>";
const endMarker = "# <<< shj3 pre-commit <<<";

const block = `${marker}
# Managed by SHJ3's scripts/install-hooks.mjs. Edit that script, not this block.
#
# Path-filtered: this repository holds more than one project, so the hook exits
# immediately unless the commit touches ${projectPrefix || "this project"}.
if git diff --cached --name-only | grep -q '^${projectPrefix}/'; then
  echo "[shj3] running pre-commit gates"
  ( cd "$(git rev-parse --show-toplevel)/${projectPrefix}" && node scripts/verify.mjs --staged ) || {
    echo ""
    echo "[shj3] pre-commit gates failed."
    echo "[shj3] With no CI configured (ADR-0008), these gates are the only enforcement that exists."
    echo "[shj3] --no-verify bypasses the schema-drift check and the graph isolation gate. Please fix instead."
    exit 1
  }
fi
${endMarker}`;

if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

let contents = "";
if (existsSync(hookPath)) {
  contents = readFileSync(hookPath, "utf8");
  if (contents.includes(marker)) {
    // Replace our block in place, leaving anyone else's hook content alone.
    const start = contents.indexOf(marker);
    const end = contents.indexOf(endMarker) + endMarker.length;
    contents = contents.slice(0, start) + block + contents.slice(end);
  } else {
    contents = `${contents.trimEnd()}\n\n${block}\n`;
  }
} else {
  contents = `#!/bin/sh\n\n${block}\n`;
}

writeFileSync(hookPath, contents, "utf8");
try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows filesystems may not support the mode bit; git for Windows does not
  // require it.
}

console.log(`Installed SHJ3 pre-commit hook → ${relative(process.cwd(), hookPath)}`);
console.log(`Scoped to changes under: ${projectPrefix || "(repository root)"}/`);
console.log("");
console.log("It runs: format check, lint, typecheck, the four static gates, and unit tests.");
console.log("Uninstall by deleting the marked block from that file.");
