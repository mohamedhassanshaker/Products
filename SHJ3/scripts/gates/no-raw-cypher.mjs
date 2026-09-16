#!/usr/bin/env node
/**
 * Gate: no raw Cypher outside the graph adapter.
 *
 * ADR-0009 rule 2. This is the load-bearing control for graph tenant isolation.
 *
 * Neo4j Community has neither multi-database nor RBAC, so the graph is the one
 * store with no infrastructure and no database-level fallback: tenant scoping is
 * emitted by a tenant-aware query builder and nothing underneath catches a
 * mistake above it. If application code can write its own Cypher, it can write
 * an unscoped query, and the isolation guarantee is gone with no second line to
 * catch it. Hence: Cypher may only exist where the builder lives.
 *
 * Enforced here rather than by review because a convention that must hold across
 * every future graph query will not survive delivery pressure (RISK-024).
 */

import { resolve, relative } from "node:path";
import {
  collectFiles,
  read,
  toPosix,
  report,
  blankCommentsAndStrings,
  matchLines,
} from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/** The only place Cypher is permitted. */
const ALLOWED = ["apps/ai/src/shj3_ai/adapters/outbound/graph/"];

/**
 * Test code is exempt, because a test's whole purpose here is to *attempt* what
 * production code may not do.
 *
 * Two concrete cases already exist: the graph isolation suite must issue an
 * unscoped query in order to assert it is refused (testing.md G1–G16), and the
 * slug validation tests carry Cypher-shaped injection payloads in order to
 * assert they never reach a label.
 *
 * This does weaken the gate — a real query could hide in a test file. That is
 * accepted for the same reason `no-unscoped-store-clients` exempts tests: test
 * code does not ship, and a gate that made the isolation suite unwritable would
 * be traded for one that makes the isolation suite untestable. The verification
 * that matters is that the *production* graph path goes through the builder,
 * which the isolation suite proves per query path.
 */
function isTestPath(rel) {
  return (
    rel.includes(".test.") ||
    rel.includes(".spec.") ||
    rel.includes("/tests/") ||
    rel.includes("/test_") ||
    rel.includes("/__tests__/")
  );
}

/**
 * Cypher clause keywords. Anchored to a word boundary and requiring following
 * whitespace so `MATCHING_RULES` or a variable named `merge` does not trip it.
 * `CALL db.` catches the schema/index procedures that provisioning uses.
 */
const CYPHER =
  /\b(MATCH|MERGE|CREATE|DETACH\s+DELETE|CALL\s+db\.|CALL\s*\{|UNWIND|OPTIONAL\s+MATCH)\s/;

function isAllowed(rel) {
  return ALLOWED.some((a) => rel.startsWith(a)) || isTestPath(rel);
}

const files = [
  ...collectFiles(resolve(ROOT, "apps"), [".ts", ".tsx", ".mts", ".py"]),
  ...collectFiles(resolve(ROOT, "packages"), [".ts", ".tsx", ".mts", ".py"]),
];

const findings = [];

for (const file of files) {
  const rel = toPosix(relative(ROOT, file));
  if (isAllowed(rel)) continue;

  const source = read(file);

  // Cheap pre-filter: most files contain no Cypher keyword at all.
  if (!CYPHER.test(source)) continue;

  // Cypher in this codebase always lives inside a string literal, so we must
  // search the raw source rather than the blanked version. But we do use the
  // blanked version to drop comment-only mentions, which are legitimate
  // (a docstring explaining why a rule exists is not a query).
  const blanked = blankCommentsAndStrings(source);

  for (const hit of matchLines(source, CYPHER)) {
    const lineIndex = hit.line - 1;
    const blankedLine = blanked.split("\n")[lineIndex] ?? "";

    // If the keyword survived blanking, it is bare code, not a string or a
    // comment — that is a syntax error in TS/Python, so it is prose we blanked
    // imperfectly. If it did NOT survive, it was inside a string or comment.
    // A string is a violation; a comment is not. Distinguish by checking
    // whether the line still holds a quote character after blanking removed
    // string *contents* but left the delimiters.
    const looksLikeComment = /^\s*(\/\/|\/\*|\*|#)/.test(hit.excerpt);
    if (looksLikeComment) continue;

    const insideString = blankedLine.includes(hit.match) === false;
    if (!insideString) continue;

    findings.push({
      file: rel,
      line: hit.line,
      excerpt: hit.excerpt,
      note: `Cypher keyword "${hit.match.trim()}" outside the graph adapter`,
    });
  }
}

const code = report({
  gate: "no-raw-cypher",
  rule: "Cypher may only appear in apps/ai/src/shj3_ai/adapters/outbound/graph/ (ADR-0009 rule 2)",
  findings,
  hint:
    "Add the operation to the GraphStore port and let the tenant-aware query builder emit it.\n" +
    "  Application code must not be able to express an unscoped graph query — Neo4j Community\n" +
    "  has no RBAC and no database boundary, so there is nothing underneath to catch it (RISK-024).",
});

process.exit(code);
