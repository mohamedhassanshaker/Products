/**
 * `IntentMetricsDaily.intentLabel` has to come from somewhere: `Conversations.intentKey`
 * (§4.15) is a free-text value the AI runtime writes (`apps/ai`), and there is no intent
 * catalogue table anywhere in `prisma/tenant/schema.prisma` mapping a key to a display
 * label (confirmed by grepping the schema before writing this — `intentLabel` is stored
 * denormalised on `IntentMetricsDaily` itself, once, at rollup time, precisely because
 * nothing else holds it).
 *
 * **Named heuristic, not a guess left implicit**: humanise the raw key
 * (`pay_utilities_bill` / `PayUtilitiesBill` -> `Pay utilities bill`) by splitting on
 * snake/kebab/camel-case boundaries and sentence-casing the result. This is a real,
 * deterministic, defensible first cut — good enough to read on B1 tab 1's "Top intents"
 * list — not a fabricated catalogue. A future wave that adds a real intent catalogue can
 * replace this function's call site without touching anything downstream of it.
 */
export function humanizeIntentKey(intentKey: string | null): string {
  const trimmed = intentKey?.trim();
  if (!trimmed) return "Unclassified";

  const words = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  if (words.length === 0) return "Unclassified";
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
