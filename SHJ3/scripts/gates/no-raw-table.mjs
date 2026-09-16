#!/usr/bin/env node
/**
 * Gate: no raw `<table>` outside the DataTable wrapper.
 *
 * design-system.md §5.5 #41 / ADR-0007: *"TanStack Table must be wrapped once,
 * well, and reused across all 14 screens rather than assembled per screen."*
 * The spec's own words are blunter still: "A screen that assembles its own
 * table fails review." Seventeen screens each hand-rolling `<table>` markup is
 * exactly how 14 divergent tables happen — different sort affordances,
 * different empty states, different keyboard behaviour, all doing the same
 * job (§12.3's `no-table-outside-datatable`).
 *
 * `DataTable` itself renders a real `<table>` internally (§5.5 #41's a11y
 * requirements are explicit: "A real `<table>` with `<caption>` … `<thead>` …
 * `<th scope=\"col\">`"), so the one legitimate `<table>` tag in the app lives
 * inside its own component directory, which is this gate's only exemption.
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report, matchLines } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/**
 * `data-table/` is the general-purpose wrapper (§5.5 #41). `chart-frame/`
 * is a second, narrow exemption added for the same reason
 * `no-hardcoded-design-values.mjs`'s `ALLOWED_PREFIXES` pre-adds one for
 * `skin-editor/`: the B-1 organisms brief calls this out by name —
 * `ChartFrame`'s mandatory "View as table" toggle needs a real `<table>` as
 * the fallback content for *one specific chart's own data*, not a reusable
 * table component, which is exactly the narrow case §12.3's rule already
 * anticipates rather than forbids. `DataTable` cannot serve this: it does
 * not exist yet either (both organisms landed in the same wave), and even
 * once built its column/sort/selection machinery would be pure overhead for
 * a chart's small, fixed series×category grid. Verified both directions
 * before landing, the same way every gate in this repository is: a
 * deliberately reintroduced `<table>` in an unrelated `components/patterns/`
 * file still fails, and `chart-frame.tsx`'s real fallback table now passes.
 *
 * `permission-matrix/` is a third, equally narrow exemption, and design-
 * system.md §5.5 #41 argues for it in its *own* text, not just this
 * organism's: DataTable's a11y section explicitly declines full 2D grid
 * keyboard navigation — "Full 2D grid navigation is reserved for
 * `PermissionMatrix`, which needs it; imposing it on 20 tables costs more
 * than it gives" — which is only a coherent sentence if `PermissionMatrix`
 * is *not* built on `DataTable` and therefore needs its own real `<table>`
 * (§5.5 #43's own a11y paragraph requires one directly: "a `<table>`; row
 * headers are the 8 permissions... column headers are the 7 roles"). Same
 * verification discipline as the other two: a reintroduced `<table>` outside
 * all three prefixes still fails; `permission-matrix.tsx`'s real grid now
 * passes.
 */
const ALLOWED_PREFIXES = [
  "apps/web/src/components/patterns/data-table/",
  "apps/web/src/components/patterns/chart-frame/",
  "apps/web/src/components/patterns/permission-matrix/",
];

const RAW_TABLE_TAG = /<table(?:\s|>|\/)/;

function isAllowed(rel) {
  return ALLOWED_PREFIXES.some((p) => rel === p || rel.startsWith(p));
}

const files = collectFiles(resolve(ROOT, "apps/web/src"), [".tsx"]);

const findings = [];
let allowed = 0;

for (const file of files) {
  const rel = toPosix(relative(ROOT, file));
  if (isAllowed(rel)) continue;
  if (rel.includes(".test.") || rel.includes(".spec.") || rel.includes(".stories.")) continue;

  const source = read(file);

  for (const hit of matchLines(source, RAW_TABLE_TAG)) {
    if (/^\s*(\/\/|\/\*|\*)/.test(hit.excerpt)) continue;

    if (/design-gate-allow:\s*\S/.test(hit.excerpt)) {
      allowed++;
      continue;
    }

    findings.push({
      file: rel,
      line: hit.line,
      excerpt: hit.excerpt,
      note: "no-table-outside-datatable: hand-assembled <table> outside the DataTable wrapper",
    });
  }
}

if (allowed > 0) {
  console.log(`  note ${allowed} documented design-gate-allow exception(s) in feature code`);
}

const code = report({
  gate: "no-raw-table",
  rule: "Every table in the app is the DataTable wrapper — a screen may not assemble its own <table> (§5.5 #41, §12.3)",
  findings,
  hint:
    "Use <DataTable> (apps/web/src/components/patterns/data-table/) instead of a hand-built\n" +
    "  <table>. If DataTable genuinely cannot serve this screen yet, that is a gap in DataTable\n" +
    "  to close, not a reason to hand-roll a fifteenth table.",
});

process.exit(code);
