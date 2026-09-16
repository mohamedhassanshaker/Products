#!/usr/bin/env node
/**
 * Gate: no hardcoded user-facing strings, and every message placeholder is
 * bidi-isolated (design-system.md §12.3's `no-hardcoded-user-string` and
 * `message-placeholders-isolated`, §11.3 rule 3).
 *
 * ---------------------------------------------------------------------------
 * no-hardcoded-user-string — HONESTLY HEURISTIC, not a precise check.
 * ---------------------------------------------------------------------------
 * There is no reliable lexical way to tell "a literal that happens to be a
 * CSS class list, a URL, or a data value" apart from "a literal that is a
 * sentence a user will read" without a real JSX parser and type information
 * (is this prop actually a `ReactNode`? does this component forward its
 * children to `t()` two layers up?). This gate does neither — it is a coarse
 * pattern match, the same tool every other gate in this directory uses, aimed
 * at the two shapes that account for nearly all real hardcoded copy:
 *
 *   1. A JSX text-node child: `<p>Click here to continue</p>`.
 *   2. A string literal on `placeholder`/`title`/`alt`/`aria-label`.
 *
 * "Looks like a sentence" is: contains a space, and starts with a letter (not
 * a symbol, a token, or a class-name shape). Both checks structurally exclude
 * anything already routed through a translation call, because `t("key")` and
 * `{t("key")}` never take the *literal-string-in-JSX* shape this gate matches
 * — a translated value always arrives as a `{...}` expression, never bare
 * text or a `attr="literal"` assignment. A mixed child like `<p>Hello
 * {name}!</p>` — literal text beside an expression, the exact "sentence by
 * concatenation" antipattern §11.3 rule 4 warns about — is a known gap: this
 * gate does not parse that shape. It will also miss anything written some
 * other way a straightforward reviewer would not expect (a string built by
 * concatenation, a literal buried three re-exports deep). Treat a clean run
 * as "nothing obvious slipped through," not as proof of full i18n coverage.
 *
 * ---------------------------------------------------------------------------
 * message-placeholders-isolated — real support, not folklore.
 * ---------------------------------------------------------------------------
 * §11.3 rule 3: every `{placeholder}` in a message must be wrapped in Unicode
 * FSI/PDI (U+2068/U+2069) so an interpolated value can never reorder inside
 * RTL prose. Before writing this, the installed runtime was checked directly
 * rather than assumed: `node_modules/.pnpm/intl-messageformat@11.2.14` (the
 * ICU engine next-intl@4.14.2 runs on) and its parser dependency
 * `@formatjs/icu-messageformat-parser@3.5.17` contain zero references to
 * "bidi", "isolat*", or the FSI/PDI code points anywhere in their source. A
 * `bidiIsolation` option does exist under that same name, but it belongs to
 * the TC39/ECMA-402 `Intl.MessageFormat` (MF2) *stage proposal*
 * (tc39/proposal-intl-messageformat) — a different, not-yet-shipped
 * specification, not the npm package this project depends on. So: option (c)
 * from the brief — no library support exists for this next-intl version, and
 * this lint-level check is the only enforcement there is.
 *
 * Scoped to simple named placeholders (`{count}`) — the shape §11.3's own
 * example uses (`"{count} حالة"`). ICU's plural/select syntax
 * (`{count, plural, one {…} other {…}}`) is structurally excluded rather than
 * misread: the pattern below matches only `{identifier}` with nothing else
 * inside the braces, so a plural/select construct's outer form never matches
 * it. Whether *that* syntax needs its own isolation rule is a real open
 * question this gate does not answer.
 *
 * ---------------------------------------------------------------------------
 * Deliberately out of scope (design-system.md §5, §12.3's own text): `shj3/
 * badge-requires-label`, `shj3/icon-button-requires-label`, `shj3/
 * no-bare-input`. These are meant to be enforced by TypeScript required-prop
 * shapes on the real components (e.g. `Badge` has no children-less form
 * because `label` is required) once the component wave that builds them
 * exists — a parallel lint rule here would be redundant with, and could
 * disagree with, that shape. Not built here on purpose.
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report, blankCommentsAndStrings } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/** A value "looks like a sentence": has a space, and starts with a letter. */
function looksLikeNaturalLanguage(text) {
  return /^[A-Za-z]/.test(text) && text.includes(" ");
}

/** Collapse and cap an excerpt so a multi-line JSX text node stays readable in the report. */
function excerptOf(text, max = 90) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

// ---------------------------------------------------------------------------
// no-hardcoded-user-string
// ---------------------------------------------------------------------------

/**
 * `>text<` with no `{`/`}` in between. Applied to the comment-and-string-
 * blanked source (not `matchLines`, which is line-scoped): Prettier routinely
 * puts JSX children on their own line, so a single-line pattern would miss
 * most real prose. Blanking strips comments (a commented-out `<p>old
 * copy</p>` must not be a finding) and, harmlessly, string-literal content
 * elsewhere in the file (which cannot itself contain a bare `<`/`>` JSX
 * boundary this check cares about). Positions are preserved by blanking, so
 * line numbers and excerpts are taken from the *original* source at the same
 * indices.
 *
 * **False positive found and fixed 2026-09-09, building the molecules wave's
 * `Slider` (design-system.md §5.4 #28)**, the same way `no-hardcoded-design-
 * values.mjs`'s arbitrary-variant false positive was root-caused rather than
 * routed around per-component (see that file's `tailwind-arbitrary-value`
 * rule comment): an arrow function's `=>` contains a bare `>` that is not a
 * JSX boundary at all, but the unqualified pattern could not tell it apart
 * from one. `const ticks = Array.from({ length: n }, (_, i) => i); return (
 * <div>` blanks to a single `>...<` span between the arrow's `>` and the
 * *next* real tag's `<` — and "return (" and a callback parameter name both
 * satisfy "contains a letter and a space," so the whole span between two
 * unrelated tokens was misread as one prose text node. This is not a rare
 * shape: `React.forwardRef(function X(...) { ... })` (a named function
 * expression, this codebase's own established convention for every
 * component's outer body) never triggers it, but an inline arrow callback
 * feeding a `.map`/`.filter`/`Array.from` computation immediately before a
 * JSX `return` — increasingly likely in data-heavier molecules and organisms
 * than it was in the plainer atoms — does. Fixed with a negative lookbehind
 * excluding a `>` immediately preceded by `=`: verified in both directions
 * before landing, using the real trigger as the negative control (`slider.tsx`
 * no longer flags) and a deliberately reintroduced literal JSX string
 * (`<p>Hello there</p>`) confirming genuine violations are still caught.
 * `Array<T>`-style generic-close `>` immediately preceding unrelated JSX is a
 * plausible sibling false positive of the same class, not yet observed in
 * this codebase and not fixed here — flagged rather than speculatively
 * patched, per this gate's own header note that a clean run is "nothing
 * obvious slipped through," not a parser-grade guarantee.
 */
const TEXT_NODE = /(?<!=)>([^<>{}]*?[A-Za-z][^<>{}]*?)</g;

/**
 * `attr="literal"` for the four text-bearing props named in the brief. Only
 * the double-quoted literal form is matched, which is what structurally
 * excludes `placeholder={t("key")}` — an expression can never follow `="`.
 * JSX in this codebase is exclusively double-quoted (Prettier's default,
 * consistent throughout); a single-quoted attribute would be missed, which is
 * an accepted, narrow gap rather than doubled regex complexity for a style
 * this project does not use.
 */
const PROP_LITERAL = /\b(placeholder|title|alt|aria-label)\s*=\s*"([^"]*)"/g;

function findHardcodedStrings(files) {
  const findings = [];

  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    if (rel.includes(".test.") || rel.includes(".spec.") || rel.includes(".stories.")) continue;

    const source = read(file);
    const blanked = blankCommentsAndStrings(source);

    TEXT_NODE.lastIndex = 0;
    let m;
    while ((m = TEXT_NODE.exec(blanked)) !== null) {
      const trimmed = m[1].trim();
      if (looksLikeNaturalLanguage(trimmed)) {
        const line = blanked.slice(0, m.index).split("\n").length;
        findings.push({
          file: rel,
          line,
          excerpt: excerptOf(source.slice(m.index, m.index + m[0].length)),
          note: "no-hardcoded-user-string: JSX text node reads as prose, not routed through next-intl",
        });
      }
      if (m.index === TEXT_NODE.lastIndex) TEXT_NODE.lastIndex++;
    }

    // Prop literals are checked against the *original* source (string content
    // must survive), with a per-line comment guard instead of blanking.
    const lines = source.split("\n");
    PROP_LITERAL.lastIndex = 0;
    while ((m = PROP_LITERAL.exec(source)) !== null) {
      const value = m[2].trim();
      if (looksLikeNaturalLanguage(value)) {
        const line = source.slice(0, m.index).split("\n").length;
        const lineText = lines[line - 1] ?? "";
        if (!/^\s*(\/\/|\/\*|\*)/.test(lineText)) {
          findings.push({
            file: rel,
            line,
            excerpt: excerptOf(lineText),
            note: `no-hardcoded-user-string: "${m[1]}" carries a literal sentence instead of a translation`,
          });
        }
      }
      if (m.index === PROP_LITERAL.lastIndex) PROP_LITERAL.lastIndex++;
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// message-placeholders-isolated
// ---------------------------------------------------------------------------

const FSI = "⁨";
const PDI = "⁩";
/** A simple named placeholder only — see header note on ICU plural/select. */
const SIMPLE_PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;

function findUnisolatedPlaceholders(files) {
  const findings = [];

  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    const lines = read(file).split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      SIMPLE_PLACEHOLDER.lastIndex = 0;
      let m;
      while ((m = SIMPLE_PLACEHOLDER.exec(line)) !== null) {
        const before = line[m.index - 1];
        const after = line[m.index + m[0].length];
        if (before !== FSI || after !== PDI) {
          findings.push({
            file: rel,
            line: i + 1,
            excerpt: line.trim(),
            note: `message-placeholders-isolated: "${m[0]}" is not wrapped in FSI/PDI (§11.3 rule 3)`,
          });
        }
        if (m.index === SIMPLE_PLACEHOLDER.lastIndex) SIMPLE_PLACEHOLDER.lastIndex++;
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------

const jsxFiles = collectFiles(resolve(ROOT, "apps/web/src"), [".tsx"]);
const messageFiles = collectFiles(resolve(ROOT, "apps/web/messages"), [".json"]);

const stringCode = report({
  gate: "no-hardcoded-user-string",
  rule: "User-facing JSX text and placeholder/title/alt/aria-label literals go through next-intl, never a bare string (§12.3)",
  findings: findHardcodedStrings(jsxFiles),
  hint:
    "Move the copy into messages/en.json and messages/ar.json under a namespace, and render it\n" +
    '  through useTranslations()/getTranslations() (t("key")) instead of a literal.',
});

const placeholderCode = report({
  gate: "message-placeholders-isolated",
  rule: "Every {placeholder} in a message catalogue is wrapped in FSI/PDI so it cannot reorder inside RTL prose (§11.3 rule 3)",
  findings: findUnisolatedPlaceholders(messageFiles),
  hint:
    'Wrap the placeholder in Unicode isolate marks: "{count} حالة" → "\\u2068{count}\\u2069 حالة".\n' +
    "  next-intl and its ICU formatter do not do this automatically (verified against the\n" +
    "  installed intl-messageformat@11.2.14 source) — the catalogue has to carry the marks.",
});

process.exit(stringCode !== 0 || placeholderCode !== 0 ? 1 : 0);
