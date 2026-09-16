#!/usr/bin/env node
/**
 * Gate: no hardcoded secrets in code, config, or docs.
 *
 * CLAUDE.md: "Secrets: never in code or docs — config/env only." Like the other
 * gates in this directory, this is unenforceable by review alone once delivery
 * pressure is on, so a machine checks it — in pre-commit, in `pnpm verify`, and
 * (via `.claude/settings.json`'s PreToolUse hook) before Claude Code ever writes
 * the content to disk in the first place.
 *
 * Deliberately precision-over-recall: a blocking gate that fires on legitimate
 * placeholder values (`password=changeme` in a deployment doc, a fake key in a
 * test fixture) trains people to reach for --no-verify, which is worse than no
 * gate at all (RISK-002). So this only flags shapes that are realistically real
 * secrets — a live AWS key, a PEM private key block, or a high-entropy value
 * assigned to a credential-shaped name — and exempts test paths and known
 * placeholder tokens.
 *
 * Two modes:
 *   node no-secrets.mjs                          full-repo scan (pre-commit, pnpm verify)
 *   node no-secrets.mjs --stdin --file <relPath>  single file's pending content, read from
 *                                                  stdin (the PreToolUse hook: check an
 *                                                  Edit/Write's proposed content before it
 *                                                  lands on disk, without rescanning the repo)
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report, matchLines } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function isTestPath(rel) {
  return (
    rel.includes(".test.") ||
    rel.includes(".spec.") ||
    rel.includes("/tests/") ||
    rel.includes("/test_") ||
    rel.includes("/__tests__/") ||
    rel.includes("/fixtures/")
  );
}

/** Env files are meant to hold real secrets locally and are gitignored; `.env.example` is meant to hold placeholders. Neither belongs to this gate. */
function isEnvFile(rel) {
  return /(^|\/)\.env(\..+)?$/.test(rel);
}

/** Obvious non-secret placeholder values. Case-insensitive substring match against the captured value. */
const PLACEHOLDER =
  /^(changeme|change_me|placeholder|example|sample|dummy|fake|mock|test|xxx+|your[-_]|todo|redacted|<.*>|\$\{.*\}|localhost|password\d*)$/i;

/** AWS access key id — real, load-bearing shape, essentially zero false-positive rate. */
const AWS_KEY = /\b(AKIA|ASIA)[0-9A-Z]{16}\b/;

/** PEM private key block header. */
const PEM_KEY = /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;

/**
 * A credential-shaped identifier assigned a quoted literal of real length.
 * Matches `.env`-style (`PASSWORD=...`), JS/TS (`password: "..."`, `apiKey = "..."`),
 * and Python (`password = "..."`) assignment shapes in one pattern.
 */
const ASSIGNMENT =
  /\b(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']([^"'\s]{8,})["']/gi;

function isEnvVarReference(value) {
  return /^(process\.env\.|os\.environ|env\(|getenv\()/i.test(value) || value.includes("${");
}

/** Scan one file's content for secret shapes. Returns findings without `file` set. */
function scanContent(source) {
  const findings = [];

  for (const hit of matchLines(source, AWS_KEY)) {
    findings.push({ line: hit.line, excerpt: hit.excerpt, note: "AWS access key id" });
  }
  for (const hit of matchLines(source, PEM_KEY)) {
    findings.push({ line: hit.line, excerpt: hit.excerpt, note: "PEM private key block" });
  }

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ASSIGNMENT.lastIndex = 0;
    let m;
    while ((m = ASSIGNMENT.exec(line)) !== null) {
      const value = m[2];
      if (isEnvVarReference(value) || PLACEHOLDER.test(value)) continue;
      findings.push({
        line: i + 1,
        excerpt: line,
        note: `hardcoded value for "${m[1]}"`,
      });
    }
  }

  return findings;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function runStdinMode(relPath) {
  const rel = toPosix(relPath);
  if (isEnvFile(rel) || isTestPath(rel)) {
    console.log(`  ok   no-secrets  (${rel} exempt)`);
    process.exit(0);
  }

  const content = await readStdin();
  const findings = scanContent(content).map((f) => ({ ...f, file: rel }));

  const code = report({
    gate: "no-secrets",
    rule: "No hardcoded secret values in code, config, or docs — env/config only (CLAUDE.md)",
    findings,
    hint:
      "Move the value to an environment variable / secret manager and reference it\n" +
      "  (process.env.X / os.environ / config), or if it's genuinely a placeholder,\n" +
      '  use an unambiguous placeholder word (e.g. "changeme", "<your-api-key>").',
  });
  process.exit(code);
}

function runFullRepoScan() {
  const files = collectFiles(ROOT, [
    ".ts",
    ".tsx",
    ".mts",
    ".mjs",
    ".js",
    ".jsx",
    ".py",
    ".yml",
    ".yaml",
    ".md",
    ".json",
  ]);

  const findings = [];

  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    if (isEnvFile(rel) || isTestPath(rel)) continue;

    const source = read(file);
    for (const f of scanContent(source)) findings.push({ ...f, file: rel });
  }

  const code = report({
    gate: "no-secrets",
    rule: "No hardcoded secret values in code, config, or docs — env/config only (CLAUDE.md)",
    findings,
    hint:
      "Move the value to an environment variable / secret manager and reference it\n" +
      "  (process.env.X / os.environ / config), or if it's genuinely a placeholder,\n" +
      '  use an unambiguous placeholder word (e.g. "changeme", "<your-api-key>").',
  });
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.includes("--stdin")) {
  const fileIdx = args.indexOf("--file");
  const relPath = fileIdx !== -1 ? args[fileIdx + 1] : null;
  if (!relPath) {
    console.error("--stdin requires --file <relPath>");
    process.exit(2);
  }
  await runStdinMode(relPath);
} else {
  runFullRepoScan();
}
