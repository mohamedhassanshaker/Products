#!/usr/bin/env node
/**
 * Gate: token-reference validity (design-system.md §12.3, ADR-0007's token
 * contract).
 *
 * Two checks over every `var(--x)` reference in feature code:
 *
 *   no-primitive-token-reference — `x` names a layer-1 primitive. Feature code
 *   may only consume layer-2 (semantic) and layer-3 (component) tokens; a
 *   primitive is a value decision, and a value cannot be re-pointed by a
 *   tenant (packages/tokens/src/primitives.ts). Layer 1 is for the emitter and
 *   the Tailwind config only.
 *
 *   no-undefined-token — `x` does not name any known semantic or component
 *   token. An undefined custom property resolves to nothing, which for a
 *   colour means `unset` and for text often means invisible — so a typo like
 *   `--muted-forground` must fail here rather than render a blank region a
 *   reviewer reads as a styling bug instead of a spelling error.
 *
 * The valid name set is imported from `@shj3/tokens` rather than re-derived,
 * specifically `toCssCustomPropertyName` — the exact function the runtime
 * emitter (packages/tokens/src/css.ts) uses to turn a camelCase token key into
 * its `--kebab-case` custom-property name. Importing it (the same way
 * scripts/generate-tailwind-theme.mjs already imports from `@shj3/tokens`)
 * means this gate can never quietly disagree with the emitter about what a
 * valid name is — a second, hand-written kebab-case rule here would be a
 * second thing to drift from the first.
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report, matchLines } from "./lib/walk.mjs";
import {
  COMPONENT_TOKEN_NAMES,
  PRIMITIVE_PREFIX,
  SEMANTIC_TOKEN_NAMES,
  toCssCustomPropertyName,
} from "@shj3/tokens";

const ROOT = resolve(import.meta.dirname, "../..");

/** Layer 1 and the theme plumbing are where a primitive reference is legitimate. */
const ALLOWED_PREFIXES = ["packages/tokens/", "packages/ui/src/theme/"];

/** `--shj3-` (or whatever @shj3/tokens actually emits) — never assumed literally. */
const PRIMITIVE_VAR_PREFIX = `--${PRIMITIVE_PREFIX}`;

/**
 * Custom-property namespaces this gate does not own. Radix primitives (the
 * shadcn/ui baseline this project builds components on) inject sizing/
 * transform-origin variables at runtime from measured DOM geometry —
 * `--radix-select-trigger-height`, `--radix-popover-content-available-width`,
 * and the like. These can never be design tokens: nothing in packages/tokens
 * could define a value nobody knows until layout runs. Flagging them as
 * "undefined" would not be catching a typo, it would be banning a documented,
 * idiomatic Radix pattern already in this codebase (components/ui/select.tsx).
 * Narrow and evidence-based: these are the vendor prefixes actually observed
 * in the repository, not a speculative list.
 *
 * `xy-` is @xyflow/react's own prefix (`--xy-*`) for its default stylesheet's
 * theming hooks (node/edge/handle/controls colours, etc.) — flow-canvas-graph
 * remaps every one of these to a real token in globals.css, but the bare
 * `--xy-*` name itself is vendor-owned, not a design-system token.
 */
const VENDOR_VAR_PREFIXES = ["radix-", "xy-"];

/** Every layer-2/layer-3 name, in the exact `--kebab-case` form the emitter produces. */
const VALID_TOKEN_VARS = new Set(
  [...SEMANTIC_TOKEN_NAMES, ...COMPONENT_TOKEN_NAMES].map((name) => toCssCustomPropertyName(name)),
);

function isAllowed(rel) {
  return ALLOWED_PREFIXES.some((p) => rel === p || rel.startsWith(p));
}

/** `var(--foo` → `--foo`. Stops at the first character that cannot be part of a custom-property name. */
const VAR_REFERENCE = /var\(\s*(--[A-Za-z0-9-]+)/;

const files = [
  ...collectFiles(resolve(ROOT, "apps/web"), [".ts", ".tsx", ".css"]),
  ...collectFiles(resolve(ROOT, "packages"), [".ts", ".tsx", ".css"]),
];

const primitiveFindings = [];
const undefinedFindings = [];
let allowed = 0;

for (const file of files) {
  const rel = toPosix(relative(ROOT, file));
  if (isAllowed(rel)) continue;
  if (rel.includes(".test.") || rel.includes(".spec.")) continue;

  const source = read(file);

  for (const hit of matchLines(source, VAR_REFERENCE)) {
    if (/^\s*(\/\/|\/\*|\*)/.test(hit.excerpt)) continue;

    // matchLines re-runs the pattern globally per line; re-extract this hit's
    // captured name rather than trusting `hit.match`, which is the whole match.
    const captured = VAR_REFERENCE.exec(hit.excerpt)?.[1];
    if (!captured) continue;

    if (/design-gate-allow:\s*\S/.test(hit.excerpt)) {
      allowed++;
      continue;
    }

    if (captured.startsWith(PRIMITIVE_VAR_PREFIX)) {
      primitiveFindings.push({
        file: rel,
        line: hit.line,
        excerpt: hit.excerpt,
        note: `no-primitive-token-reference: "${captured}" is a layer-1 primitive — feature code consumes semantic/component tokens only`,
      });
      continue;
    }

    if (VENDOR_VAR_PREFIXES.some((p) => captured.startsWith(`--${p}`))) continue;

    if (!VALID_TOKEN_VARS.has(captured)) {
      undefinedFindings.push({
        file: rel,
        line: hit.line,
        excerpt: hit.excerpt,
        note: `no-undefined-token: "${captured}" does not match any semantic or component token`,
      });
    }
  }
}

if (allowed > 0) {
  console.log(`  note ${allowed} documented design-gate-allow exception(s) in feature code`);
}

const primitiveCode = report({
  gate: "no-primitive-token-reference",
  rule: "Feature code references layer-2 (semantic) and layer-3 (component) tokens only, never a layer-1 primitive (§12.3, ADR-0007)",
  findings: primitiveFindings,
  hint:
    "Reference the semantic or component token that already wraps this primitive, rather than\n" +
    "  the primitive itself — check packages/tokens/src/semantic.ts or components.ts for the\n" +
    "  role that already carries this value. A primitive cannot be re-pointed by a tenant skin.",
});

const undefinedCode = report({
  gate: "no-undefined-token",
  rule: "Every var(--x) reference must name a real semantic or component token (§12.3, ADR-0007)",
  findings: undefinedFindings,
  hint:
    "Check packages/tokens/src/semantic.ts and components.ts for the correct name — an\n" +
    "  undefined custom property resolves to nothing, which usually means invisible text or an\n" +
    "  unstyled region rather than a visible error. This is very often a typo.",
});

process.exit(primitiveCode !== 0 || undefinedCode !== 0 ? 1 : 0);
