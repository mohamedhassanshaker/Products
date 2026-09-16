#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook (Edit|Write): block a write before it lands on
 * disk if its pending content matches scripts/gates/no-secrets.mjs's rules.
 *
 * The gate script itself is the single source of truth for what counts as a
 * secret (also run at `pnpm gate` / `pnpm verify` / pre-commit) — this wrapper
 * only adapts the Claude Code hook stdin/JSON contract to that script's
 * `--stdin --file <path>` mode, so the two never drift apart.
 */

import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const GATE = resolve(ROOT, "scripts/gates/no-secrets.mjs");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const raw = await readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  // Malformed input isn't this hook's problem to fail the tool call over.
  allow();
}

const filePath = input?.tool_input?.file_path;
// Write carries the full file content; Edit carries only the replacement text —
// checking new_string is enough, since old_string was already on disk (and
// already passed this same gate when it was written).
const content = input?.tool_input?.content ?? input?.tool_input?.new_string;

if (!filePath || typeof content !== "string" || content.length === 0) allow();

const relPath = relative(ROOT, filePath).split("\\").join("/");
// Outside the project (e.g. editing a file elsewhere on disk) — not this gate's concern.
if (relPath.startsWith("..")) allow();

const result = spawnSync("node", [GATE, "--stdin", "--file", relPath], {
  input: content,
  cwd: ROOT,
  encoding: "utf8",
});

if (result.status === 0) allow();

deny(`no-secrets gate failed for ${relPath}:\n\n${result.stdout || result.stderr}`.trim());
