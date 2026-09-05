/**
 * `PostToolResult` prompt-injection screening (Phase 6, BL-30, FR-SEC-09 — the
 * inbound-tool-result/retrieved-chunk clause; the output-policy and groundedness
 * clauses of FR-SEC-09 ship later with their dependent modules, LLD §14.9.1). Runs
 * **immediately after a tool returns, before the result ever reaches model context or
 * rendering** — a Fetch-class connector can return attacker-controlled text today with
 * zero screening (the Blueprint's own gap G-04), and this closes exactly that gap.
 *
 * A pure, dependency-free heuristic (matches `guardrail-eval.ts`'s existing
 * `PreToolCall` stub-rule convention: no model call, no DB — a cheap, deterministic,
 * exhaustively unit-testable first line of defense). Detects the shapes a prompt
 * injection payload characteristically takes when it's trying to hijack the
 * conversation from *inside* tool output: an instruction to disregard prior
 * instructions, a forged system/role delimiter, or a forged tool-result/function-call
 * envelope. This is deliberately narrow and pattern-based, not a semantic classifier —
 * exactly the same trade-off `guardrail-eval.ts`'s own stub rule set already made, and
 * upgradeable to a model-backed detector later (LLD's `detector: model:<routeVersionId>`
 * naming already anticipates that) without changing this function's call site.
 */
export interface InjectionScanResult {
  matched: boolean;
  /** `"heuristic:<name>"` — LLD §14.9.1's own naming convention for `guardrail_event.
   * detector`, distinguishing a pattern-matched hit from a future `model:<routeVersionId>`
   * detector without changing the schema. */
  detector: string;
  /** `1` for a heuristic pattern hit (binary), `0` for no match — a heuristic detector
   * has no natural continuous confidence; kept as a number (not a boolean) so a future
   * model-backed detector can report a real confidence score through the same field. */
  score: number;
  /** Truncated (≤200 chars) excerpt of the matched text — the caller is responsible
   * for masking any PII in it (via `@nextbot/pii`) before persisting, this function
   * only truncates. */
  matchedExcerpt?: string;
}

const MAX_EXCERPT_LENGTH = 200;

/** Each pattern targets a *shape*, not a specific wording, so paraphrases of the same
 * attack still match (e.g. "disregard every earlier instruction" as well as "ignore
 * all previous instructions"). Every pattern is anchored to an instruction-override or
 * forged-delimiter shape — plain mentions of the words "system" or "instructions" in
 * ordinary content (e.g. a product description that says "see system requirements")
 * do not match any of these. */
const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: "override-prior-instructions",
    re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+|every\s+)?(previous|prior|earlier|above|preceding)\s+(instructions?|prompts?|rules?|messages?)\b/i,
  },
  {
    name: "assume-new-role",
    re: /\byou\s+are\s+now\s+(a|an|the)\b|\bact\s+as\s+(a|an|the)\s+(system|developer|administrator)\b/i,
  },
  {
    name: "forged-system-delimiter",
    re: /(^|\n)\s*(system|developer)\s*:\s|<\|?(system|im_start|im_end)\|?>|###\s*(system|instruction)/i,
  },
  {
    name: "forged-tool-result-envelope",
    re: /\b(new|updated)\s+instructions?\s*:\s|\breveal\s+(the\s+)?(system\s+prompt|your\s+instructions)\b/i,
  },
  {
    name: "exfiltration-request",
    re: /\bsend\s+(the\s+)?(api\s*key|credentials?|password|secret|token)s?\s+to\b/i,
  },
];

function truncate(text: string): string {
  return text.length > MAX_EXCERPT_LENGTH ? `${text.slice(0, MAX_EXCERPT_LENGTH)}…` : text;
}

/** Scans one string for any injection-shaped pattern; returns the first match (array
 * order is the precedence order, mirroring `evaluateGuardrails`'s existing
 * first-match-wins convention). */
export function scanTextForPromptInjection(text: string): InjectionScanResult {
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.re.exec(text);
    if (match) {
      return { matched: true, detector: `heuristic:${pattern.name}`, score: 1, matchedExcerpt: truncate(match[0]) };
    }
  }
  return { matched: false, detector: "heuristic:none", score: 0 };
}

/** Recursively collects every string reachable from an arbitrary tool-result value
 * (objects/arrays nested arbitrarily deep — a tool result is not guaranteed to be a
 * flat shape) and scans each. Mirrors `@nextbot/pii`'s `maskJsonValue` traversal
 * shape, applied to detection instead of masking. Depth-bounded (`maxDepth`) so a
 * pathological deeply-nested payload can't turn a single tool result into unbounded
 * work — a tool result this deep has no legitimate reason to be, and the bound itself
 * is not a security control (an attacker nesting a payload past the bound simply
 * produces an unscanned tail, not a bypass of anything this guardrail exists to stop
 * at reasonable depths). */
const MAX_SCAN_DEPTH = 20;

export function scanValueForPromptInjection(value: unknown, depth = 0): InjectionScanResult {
  if (depth > MAX_SCAN_DEPTH) return { matched: false, detector: "heuristic:none", score: 0 };
  if (typeof value === "string") return scanTextForPromptInjection(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = scanValueForPromptInjection(item, depth + 1);
      if (result.matched) return result;
    }
    return { matched: false, detector: "heuristic:none", score: 0 };
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const result = scanValueForPromptInjection(item, depth + 1);
      if (result.matched) return result;
    }
  }
  return { matched: false, detector: "heuristic:none", score: 0 };
}
