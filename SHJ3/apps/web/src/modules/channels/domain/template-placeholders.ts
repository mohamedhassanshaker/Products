/** `{{1}}`, `{{2}}`, ... — Meta's own WhatsApp template placeholder syntax, one-indexed. */
const PLACEHOLDER_PATTERN = /\{\{\d+\}\}/g;

/** api.md §6.9: "Body placeholder count must match `variables.length` → `422`." Counts
 *  distinct placeholder tokens, so `{{1}} ... {{1}}` (the same variable referenced twice)
 *  still requires only one declared variable, matching how Meta templates actually work. */
export function placeholderCountMatchesVariables(body: string, variableCount: number): boolean {
  const matches = body.match(PLACEHOLDER_PATTERN) ?? [];
  const distinct = new Set(matches);
  return distinct.size === variableCount;
}
