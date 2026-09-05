/**
 * QA Defect U3 (2026-08-15 UI pass, medium): `js-yaml`'s parse errors surface raw
 * parser internals verbatim — e.g. `"bad indentation of a mapping entry (1:11)"` plus
 * a caret-diagram snippet — accurate for a developer, meaningless for an end user.
 * Schema-validation errors on the same screen are already humanized via
 * `humanize-field-error.ts`'s precedent; this does the equivalent for the parse-error
 * case, which bypassed that humanization entirely. Doesn't attempt to fully parse the
 * parser's own diagnostic — a simple "check line N" is what the fix instructions
 * call for.
 *
 * `js-yaml`'s `YAMLException` carries a `mark.line` (0-based) when the error is
 * attributable to a specific position in the source; when that's present, the message
 * names the (1-based) line. Falls back to a generic message when it isn't (e.g. an
 * error thrown for a reason `js-yaml` can't attribute to one line).
 */
export function humanizeYamlParseError(err: unknown): string {
  const mark = (err as { mark?: { line?: number } } | null)?.mark;
  if (mark && typeof mark.line === "number") {
    return `There's a syntax error in your YAML — check line ${mark.line + 1}.`;
  }
  return "There's a syntax error in your YAML — double-check indentation and formatting.";
}
