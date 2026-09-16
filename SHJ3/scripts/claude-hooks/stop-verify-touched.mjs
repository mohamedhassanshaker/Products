#!/usr/bin/env node
/**
 * Claude Code Stop hook: after each response, verify the files Claude actually
 * touched this session against the repo's static gates (scripts/gates/*.mjs)
 * plus prettier/eslint — without requiring the whole repo to be clean.
 *
 * Scoped to touched files (tracked by posttool-track-touched.mjs) rather than
 * running `pnpm verify`/`pnpm gate` unscoped, because this repo can carry
 * pre-existing violations in files nobody touched this turn; blocking Stop on
 * those would fail every turn for reasons unrelated to what Claude did. The
 * full, unscoped `pnpm verify` still runs at git pre-commit (scripts/install-hooks.mjs)
 * as the final, heavier gate — this is a fast per-turn safety net, not a
 * replacement for it.
 *
 * Deliberately does not run the test suites here (unit/integration/e2e) — those
 * stay a per-task judgment call under CLAUDE.md's "Verification Before Done",
 * not a per-turn mechanical block; this hook covers the checks that are cheap
 * enough to run after every response and unambiguous about what a violation
 * means (a hardcoded secret, an unformatted file, an undefined design token).
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const STATE_DIR = resolve(ROOT, ".claude/hooks-state");

/** Static gates — mirrors the `gate:*` scripts in package.json. */
const GATES = [
  "no-secrets.mjs",
  "no-hardcoded-design-values.mjs",
  "no-raw-cypher.mjs",
  "no-unscoped-store-clients.mjs",
  "prisma-sqlalchemy-drift.mjs",
  "tailwind-theme-drift.mjs",
  "no-undefined-token.mjs",
  "no-raw-table.mjs",
  "no-hardcoded-user-string.mjs",
  "user-guide-coverage.mjs",
];

const PRETTIER_EXTS = [
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
];
const ESLINT_EXTS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

/** Lines shaped like the shared `report()` helper's finding format: "    <file>:<line>". */
function filesReportedIn(text) {
  const found = new Set();
  for (const line of text.split("\n")) {
    const m = /^ {4}(\S+):(\d+)$/.exec(line);
    if (m) found.add(m[1]);
  }
  return found;
}

const raw = await readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  allow();
}

const sessionId = input?.session_id;
const stateFile = sessionId ? resolve(STATE_DIR, `${sessionId}.touched`) : null;
if (!stateFile || !existsSync(stateFile)) allow();

const touched = readFileSync(stateFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((relPath) => existsSync(resolve(ROOT, relPath))); // skip deleted files

if (touched.length === 0) allow();

const touchedSet = new Set(touched);
const failures = [];

// --- prettier -------------------------------------------------------------
const prettierTargets = touched.filter((f) => PRETTIER_EXTS.some((ext) => f.endsWith(ext)));
if (prettierTargets.length > 0) {
  const result = spawnSync("pnpm", ["exec", "prettier", "--check", ...prettierTargets], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    failures.push(`format (prettier):\n${(result.stdout || result.stderr || "").trim()}`);
  }
}

// --- eslint -----------------------------------------------------------------
const eslintTargets = touched.filter((f) => ESLINT_EXTS.some((ext) => f.endsWith(ext)));
if (eslintTargets.length > 0) {
  const result = spawnSync("pnpm", ["exec", "eslint", ...eslintTargets, "--max-warnings=0"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    failures.push(`lint (eslint):\n${(result.stdout || result.stderr || "").trim()}`);
  }
}

// --- static gates, filtered to touched files --------------------------------
for (const gate of GATES) {
  const gatePath = resolve(ROOT, "scripts/gates", gate);
  const result = spawnSync("node", [gatePath], { cwd: ROOT, encoding: "utf8" });
  if (result.status === 0) continue;

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const reportedFiles = filesReportedIn(output);
  const overlap = [...reportedFiles].filter((f) => touchedSet.has(f));
  if (overlap.length > 0) {
    failures.push(`${gate} (violates: ${overlap.join(", ")}):\n${output.trim()}`);
  }
  // else: gate is red, but only for files this turn never touched — not this turn's problem.
}

// Clean up so a finished session's state doesn't linger indefinitely.
if (failures.length === 0) {
  try {
    unlinkSync(stateFile);
  } catch {
    // best-effort
  }
  allow();
}

block(
  `Verification failed for file(s) this turn touched (${touched.join(", ")}):\n\n` +
    failures.join("\n\n---\n\n") +
    "\n\nFix before considering this done. (Pre-existing issues in files you didn't touch are not included here.)",
);
