#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook (Edit|Write): record which files this session
 * touched, so the Stop hook (stop-verify-touched.mjs) can scope its checks to
 * just this turn's changes instead of the whole repo.
 *
 * Necessary because the repo can (and currently does) carry pre-existing
 * gate/format violations in files nobody touched this session — blocking Stop
 * on those would make every turn fail for reasons unrelated to what Claude did.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const STATE_DIR = resolve(ROOT, ".claude/hooks-state");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const raw = await readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const sessionId = input?.session_id;
const filePath = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
if (!sessionId || !filePath) process.exit(0);

const relPath = relative(ROOT, filePath).split("\\").join("/");
if (relPath.startsWith("..")) process.exit(0); // outside the project

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

const stateFile = resolve(STATE_DIR, `${sessionId}.touched`);
const existing = existsSync(stateFile) ? readFileSync(stateFile, "utf8").split("\n") : [];
if (!existing.includes(relPath)) appendFileSync(stateFile, `${relPath}\n`, "utf8");

process.exit(0);
