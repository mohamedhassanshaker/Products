/**
 * Shared file-walking and reporting helpers for the static gates.
 *
 * The gates exist because several rules in this project are unenforceable by
 * review alone — ADR-0007's "no hardcoded design values" and ADR-0009's "no raw
 * Cypher outside the graph adapter" both decay under delivery pressure unless a
 * machine checks them. With no CI (ADR-0008) these run in pre-commit and in
 * `pnpm verify`, which makes them the only enforcement that exists.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ALWAYS_SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "__pycache__",
  ".ruff_cache",
  ".pytest_cache",
  ".turbo",
  "playwright-report",
  "test-results",
]);

/**
 * Recursively collect files under `root` whose extension is in `extensions`.
 *
 * @param {string} root absolute directory to walk
 * @param {string[]} extensions e.g. [".ts", ".tsx"]
 * @param {(relPath: string) => boolean} [skipDir] extra directory filter, receives a repo-relative path
 * @returns {string[]} absolute file paths
 */
export function collectFiles(root, extensions, skipDir) {
  /** @type {string[]} */
  const found = [];

  function recurse(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // directory may legitimately not exist yet
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        if (skipDir && skipDir(toPosix(relative(root, full)))) continue;
        recurse(full);
      } else if (entry.isFile() && extensions.some((e) => entry.name.endsWith(e))) {
        found.push(full);
      }
    }
  }

  try {
    if (!statSync(root).isDirectory()) return found;
  } catch {
    return found;
  }

  recurse(root);
  return found;
}

/** Normalise Windows separators so gate paths and allowlists compare identically. */
export function toPosix(p) {
  return p.split(sep).join("/");
}

export function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Strip line and block comments plus string-literal contents so a gate matches
 * real code rather than prose. Deliberately simple: it blanks matched regions
 * with spaces so line and column numbers survive intact.
 *
 * Not a parser. It is sufficient because every gate here looks for coarse
 * lexical patterns, and blanking strings is what stops a documentation example
 * or a test fixture from being reported as a violation.
 */
export function blankCommentsAndStrings(source) {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  let state = "code"; // code | line | block | single | double | backtick

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (state === "code") {
      if (c === "/" && next === "/") {
        const end = source.indexOf("\n", i);
        const stop = end === -1 ? n : end;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end === -1 ? n : end + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "#") {
        // Python comment. Harmless in TS since `#` only appears in private
        // fields, and blanking to end of line there would be wrong — so only
        // treat it as a comment when the file is Python, decided by the caller
        // passing already-filtered content. Conservative: skip.
      }
      if (c === "'" || c === '"' || c === "`") {
        state = c === "'" ? "single" : c === '"' ? "double" : "backtick";
        i++;
        continue;
      }
      i++;
      continue;
    }

    // inside a string literal
    if (c === "\\") {
      blank(i, i + 2);
      i += 2;
      continue;
    }
    const closing =
      (state === "single" && c === "'") ||
      (state === "double" && c === '"') ||
      (state === "backtick" && c === "`");
    if (closing) {
      state = "code";
      i++;
      continue;
    }
    blank(i, i + 1);
    i++;
  }

  return out.join("");
}

/** Report findings and exit. Keeps every gate's output shape identical. */
export function report({ gate, rule, findings, hint }) {
  if (findings.length === 0) {
    console.log(`  ok   ${gate}`);
    return 0;
  }

  console.error(`\n  FAIL ${gate} — ${findings.length} violation(s)\n`);
  console.error(`  Rule: ${rule}\n`);
  for (const f of findings) {
    console.error(`    ${f.file}:${f.line}`);
    console.error(`      ${f.excerpt.trim()}`);
    if (f.note) console.error(`      → ${f.note}`);
  }
  if (hint) console.error(`\n  ${hint}\n`);
  return 1;
}

/** Find every line in `source` matching `pattern`, returning 1-indexed lines. */
export function matchLines(source, pattern) {
  /** @type {{ line: number, excerpt: string, match: string }[]} */
  const hits = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      hits.push({ line: i + 1, excerpt: lines[i], match: m[0] });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return hits;
}
