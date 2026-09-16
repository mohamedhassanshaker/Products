#!/usr/bin/env node
/**
 * Gate: every real page has a user-guide entry, and every guide entry still points at a
 * real page (design-system.md §5.5 #56, CLAUDE.md's Phase F maintenance rule: "a PR adding
 * or changing a page must add or update its guide entry" — the real, enforced half of that
 * rule this project's own tooling can check without CI, per ADR-0008).
 *
 * ## Two directions, both real findings
 *
 *  - **Missing**: a real `page.tsx` exists under `apps/web/src/app/[locale]/` with no
 *    `GUIDE_REGISTRY` entry naming its route in `coversRoutes` — a page shipped with no
 *    guide entry, exactly the rule CLAUDE.md's Phase F section states plainly fails review.
 *  - **Stale**: a `GUIDE_REGISTRY` entry's `coversRoutes` names a route with no real
 *    `page.tsx` behind it any more — the sibling mistake (a route deleted or renamed, its
 *    guide entry left pointing at nothing), just as real a drift as the first direction and
 *    just as easy to miss without a gate checking for it.
 *
 * ## Why this reads `guide-registry.ts` as text rather than importing it
 *
 * Every other gate in this directory is a plain `node scripts/gates/*.mjs` process — no
 * `tsx`/ts-node loader, per `scripts/verify.mjs`'s own stage list (`cmd: "node"` throughout).
 * Node cannot `import` a `.ts` file directly, so this gate extracts `GUIDE_REGISTRY`'s
 * `coversRoutes` arrays and `GUIDE_COVERAGE_EXEMPT_ROUTES` with a small, deliberately narrow
 * regex over the real source file — not a general TS parser, just enough structure to read
 * back the one array shape `guide-registry.ts` actually uses. `application/get-guide-entry.
 * test.ts`'s own "every registry entry has real content" test is the complementary check
 * that runs *with* full TypeScript type-checking (via Vitest) — this gate's job is narrower
 * and different: real routes vs. the registry, not registry vs. content.
 *
 * ## Route-from-file-path derivation
 *
 * `apps/web/src/app/[locale]/(backoffice)/agents/[id]/edit/page.tsx` → strip the fixed
 * `apps/web/src/app/[locale]` prefix and the `/page.tsx` suffix, drop any `(group)` route-
 * group segment (invisible in the real URL — confirmed directly against `next dev` by an
 * earlier wave, `(backoffice)/layout.tsx`'s own doc comment), keep dynamic segments
 * (`[id]`, `[...slug]`) literal — giving `/agents/[id]/edit`, exactly the string
 * `GUIDE_REGISTRY`'s own `coversRoutes` entries use.
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const APP_LOCALE_DIR = resolve(ROOT, "apps/web/src/app/[locale]");
const REGISTRY_FILE = resolve(ROOT, "apps/web/src/modules/userguide/domain/guide-registry.ts");

/** Extract every quoted string inside a named array constant's `[ ... ]` literal. */
function stringsInArrayConstant(source, constantName) {
  const match = new RegExp(`${constantName}[\\s\\S]*?\\[([\\s\\S]*?)\\]\\s*;`).exec(source);
  if (!match) return null;
  const body = match[1];
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Every `coversRoutes: [ ... ]` block's quoted strings, across the whole registry array.
 *
 * Deliberately **not** `[^\]]*` (a hard-stop character class): a covered route itself
 * contains a literal `]` (`"/agents/[id]/edit"`), which a no-`]`-allowed class can never
 * skip past — found for real, the first time this gate was ever run, by the coverage gate
 * failing on its own real, correct registry entry. Non-greedy `[\s\S]*?` paired with a
 * lookahead for "the `]` immediately followed by a comma" is what lets the match extend
 * past an in-string `]` (never followed by a bare comma) to the real, comma-followed array
 * close.
 */
function allCoveredRoutes(source) {
  const routes = [];
  const blockPattern = /coversRoutes:\s*\[([\s\S]*?)\](?=\s*,)/g;
  let block;
  while ((block = blockPattern.exec(source)) !== null) {
    for (const m of block[1].matchAll(/"([^"]+)"/g)) routes.push(m[1]);
  }
  return routes;
}

function routeFromPageFile(absFile) {
  const rel = toPosix(relative(APP_LOCALE_DIR, absFile)); // e.g. "(backoffice)/agents/[id]/edit/page.tsx"
  // `(^|\/)` rather than a bare `/page\.tsx$`: the root page (`apps/web/src/app/[locale]/
  // page.tsx`) resolves to a bare "page.tsx" with no directory component at all once
  // relative()'d against APP_LOCALE_DIR — found for real, the same first run that found the
  // `coversRoutes` bracket bug above, by this gate reporting a bogus "/page.tsx" route.
  const withoutPage = rel.replace(/(^|\/)page\.tsx$/, "");
  const segments = withoutPage.split("/").filter((seg) => seg !== "" && !/^\(.*\)$/.test(seg));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function isExempt(route, exemptRoutes) {
  return exemptRoutes.some(
    (exempt) => route === exempt || (exempt !== "/" && route.startsWith(`${exempt}/`)),
  );
}

const registrySource = read(REGISTRY_FILE);
const coveredRoutes = new Set(allCoveredRoutes(registrySource));
const exemptRoutes = stringsInArrayConstant(registrySource, "GUIDE_COVERAGE_EXEMPT_ROUTES") ?? [];

if (coveredRoutes.size === 0) {
  console.error(
    "  FAIL user-guide-coverage — could not parse any coversRoutes entries out of " +
      "guide-registry.ts. Either the registry is genuinely empty (should never happen once " +
      "any page ships) or this gate's own regex has drifted from the file's real shape — " +
      "check both before assuming the registry is at fault.",
  );
  process.exit(1);
}

const pageFiles = collectFiles(APP_LOCALE_DIR, [".tsx"]).filter((f) => f.endsWith("page.tsx"));
const realRoutes = new Set(pageFiles.map(routeFromPageFile));

const findings = [];

// Direction 1: every real route must be covered or explicitly exempt.
for (const route of realRoutes) {
  if (isExempt(route, exemptRoutes)) continue;
  if (!coveredRoutes.has(route)) {
    findings.push({
      file: toPosix(relative(ROOT, "apps/web/src/app/[locale]")),
      line: 1,
      excerpt: route,
      note: `user-guide-coverage: real route "${route}" has no GUIDE_REGISTRY entry covering it — add one to guide-registry.ts (and real content to modules/userguide/content/)`,
    });
  }
}

// Direction 2: every covered route must still be real.
for (const route of coveredRoutes) {
  if (!realRoutes.has(route)) {
    findings.push({
      file: toPosix(relative(ROOT, REGISTRY_FILE)),
      line: 1,
      excerpt: route,
      note: `user-guide-coverage: GUIDE_REGISTRY names "${route}" in coversRoutes, but no real page.tsx resolves to that route any more — remove or fix the stale entry`,
    });
  }
}

const code = report({
  gate: "user-guide-coverage",
  rule: "Every real backoffice/citizen route has a user-guide entry, and every guide entry still points at a real route (design-system.md §5.5 #56)",
  findings,
  hint:
    "Add a GUIDE_REGISTRY entry (apps/web/src/modules/userguide/domain/guide-registry.ts) " +
    "naming the route in coversRoutes, plus a real content/*.ts file in both locales — see " +
    "content/iam.ts for the established shape. A route that is a deliberate non-page (a " +
    "placeholder, the guide module itself) belongs in GUIDE_COVERAGE_EXEMPT_ROUTES instead, " +
    "with a comment explaining why.",
});

process.exit(code);
