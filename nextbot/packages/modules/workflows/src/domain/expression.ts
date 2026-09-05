import type { JsonValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.3) — the run-time
 * evaluator for the two tiny expression languages a workflow artifact may contain:
 *
 *  1. **Path mappings** (`AgentNode.inputMapping`, `SkillNode.inputMapping`,
 *     `ToolCallNode.argMapping`, `SubWorkflowNode.inputMapping`) — values shaped
 *     `"$.variables.x"`, resolved against the run's checkpoint variables.
 *  2. **The CEL subset** (`Edge.when` on a `Router` branch, `LoopNode.whileCondition`).
 *     `@nextbot/contracts`' `EdgeSchema` calls this "a CEL-subset expression" and
 *     Phase 15 explicitly deferred evaluation here: "this phase stores/validates
 *     `when` as a non-empty string only; a real CEL evaluator is Phase 16's runtime
 *     concern".
 *
 * **Security posture, stated up front because it is the whole reason this file is a
 * hand-written recursive-descent parser rather than three lines around a library.**
 * A `when` expression is authored content that reaches this evaluator from a
 * `workflow_version` row. It is therefore *never* passed to `eval`, `new Function`,
 * `vm`, a template engine, or any other dynamic-execution facility — the grammar below
 * is closed, produces only booleans, cannot reach any host object, cannot call a
 * function, and cannot loop. An expression that does not parse is a **fail-closed**
 * `false`, never a thrown error that could take down a pump tick and never an
 * optimistic `true`.
 *
 * **Disclosed narrowing.** This implements the subset the authored node kinds actually
 * need — path lookups, literals, the six comparison operators, `&&`/`||`, `!`, and
 * parentheses. It is not full CEL (no macros, no arithmetic, no `in`, no duration
 * literals). That is a deliberate floor rather than a stub: everything the LLD's own
 * node schemas can express is covered, and widening it later is additive. Anything
 * outside the grammar is reported as unparseable rather than silently approximated.
 */

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** A mapping value is a PATH when it starts with `$.`; anything else is a literal
 *  string the author wrote directly. Making the distinction syntactic (rather than
 *  "try to resolve, fall back to the literal") means a typo'd path resolves to
 *  `undefined` and is visible, instead of silently becoming the literal text `$.varables.x`. */
export function isPath(value: string): boolean {
  return value.startsWith("$.");
}

/**
 * Resolves a `$.`-rooted dotted path against a root object.
 *
 * Supports dotted segments and bare numeric array indices (`$.variables.items.0.id`).
 * Deliberately does NOT support bracket syntax, wildcards or filters — see this
 * module's narrowing note.
 *
 * @param path the expression, e.g. `"$.variables.customer.email"`.
 * @param root the object the `$` refers to — the executor passes
 *   `{ variables, input, output }` so a mapping can name any of them.
 * @returns the resolved value, or `undefined` if any segment is missing. Never throws:
 *   an unresolvable path is a legitimate authoring outcome the caller decides about.
 */
export function resolvePath(path: string, root: Record<string, unknown>): unknown {
  if (!isPath(path)) return undefined;
  const segments = path.slice(2).split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    // `Object.prototype.hasOwnProperty` rather than `in`/direct indexing so an
    // authored path can never reach a prototype member (`__proto__`, `constructor`,
    // `toString`) and pull a host object into the run's data plane.
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Applies a whole `Record<string,string>` mapping, resolving every `$.`-rooted value
 * and passing every other value through as a literal.
 *
 * @param mapping the authored mapping (`inputMapping`/`argMapping`).
 * @param root the resolution root (see `resolvePath`).
 * @returns a plain object suitable for use as a node's input/args. Keys whose path did
 *   not resolve are present with value `null` rather than omitted — an absent key and
 *   a key that resolved to nothing are genuinely different things to a downstream tool
 *   schema, and silently dropping the key would make a mapping typo look like a
 *   deliberate omission.
 */
export function applyMapping(mapping: Record<string, string>, root: Record<string, unknown>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, expression] of Object.entries(mapping)) {
    out[key] = isPath(expression) ? toJsonValue(resolvePath(expression, root)) : expression;
  }
  return out;
}

/** Coerces an arbitrary resolved value into the closed `JsonValue` shape the
 *  checkpoint schema accepts. `undefined`, functions and symbols become `null`; a
 *  Date becomes its ISO string. Applied on the way INTO the checkpoint so a run's
 *  persisted data plane can never contain something `WorkflowCheckpointSchema` would
 *  reject at the next resume. */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonValue(v);
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The CEL subset
// ---------------------------------------------------------------------------

type Token = { kind: "path" | "string" | "number" | "op" | "ident"; value: string };

const OPERATORS = ["&&", "||", "==", "!=", ">=", "<=", ">", "<", "!", "(", ")"] as const;

/** Splits an expression into tokens. Returns `null` for any character outside the
 *  grammar, which the caller turns into a fail-closed `false`. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = source.indexOf(ch, i + 1);
      if (end === -1) return null; // unterminated string literal
      tokens.push({ kind: "string", value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === "$") {
      let end = i;
      while (end < source.length && /[$.\w]/.test(source[end]!)) end += 1;
      tokens.push({ kind: "path", value: source.slice(i, end) });
      i = end;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(source[i + 1] ?? ""))) {
      let end = i + 1;
      while (end < source.length && /[0-9.]/.test(source[end]!)) end += 1;
      tokens.push({ kind: "number", value: source.slice(i, end) });
      i = end;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      tokens.push({ kind: "op", value: op });
      i += op.length;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let end = i;
      while (end < source.length && /\w/.test(source[end]!)) end += 1;
      tokens.push({ kind: "ident", value: source.slice(i, end) });
      i = end;
      continue;
    }
    return null; // a character the grammar has no production for
  }
  return tokens;
}

/** Recursive-descent parser + evaluator over the token stream. Kept as one closure so
 *  the cursor is not shared state, which makes the whole evaluator re-entrant. */
function evaluateTokens(tokens: Token[], root: Record<string, unknown>): boolean | null {
  let cursor = 0;
  const peek = (): Token | undefined => tokens[cursor];
  const take = (): Token | undefined => tokens[cursor++];

  /** `primary := '(' or | '!' primary | path | literal` — returns a raw value, since
   *  a comparison's operands are values, not booleans. */
  function parsePrimary(): { ok: true; value: unknown } | { ok: false } {
    const token = take();
    if (!token) return { ok: false };
    if (token.kind === "op" && token.value === "(") {
      const inner = parseOr();
      if (!inner.ok) return { ok: false };
      const close = take();
      if (!close || close.value !== ")") return { ok: false };
      return { ok: true, value: inner.value };
    }
    if (token.kind === "op" && token.value === "!") {
      const inner = parsePrimary();
      if (!inner.ok) return { ok: false };
      return { ok: true, value: !truthy(inner.value) };
    }
    if (token.kind === "path") return { ok: true, value: resolvePath(token.value, root) };
    if (token.kind === "string") return { ok: true, value: token.value };
    if (token.kind === "number") return { ok: true, value: Number(token.value) };
    if (token.kind === "ident") {
      if (token.value === "true") return { ok: true, value: true };
      if (token.value === "false") return { ok: true, value: false };
      if (token.value === "null") return { ok: true, value: null };
      return { ok: false }; // a bare identifier is not a reachable name in this grammar
    }
    return { ok: false };
  }

  /** `comparison := primary [ ('=='|'!='|'>'|'<'|'>='|'<=') primary ]` */
  function parseComparison(): { ok: true; value: unknown } | { ok: false } {
    const left = parsePrimary();
    if (!left.ok) return { ok: false };
    const next = peek();
    if (!next || next.kind !== "op" || !["==", "!=", ">", "<", ">=", "<="].includes(next.value)) return left;
    take();
    const right = parsePrimary();
    if (!right.ok) return { ok: false };
    return { ok: true, value: compare(next.value, left.value, right.value) };
  }

  /** `and := comparison { '&&' comparison }` — short-circuits, so a right-hand side
   *  whose path does not resolve is never even consulted once the left is false. */
  function parseAnd(): { ok: true; value: unknown } | { ok: false } {
    let left = parseComparison();
    if (!left.ok) return { ok: false };
    while (peek()?.kind === "op" && peek()?.value === "&&") {
      take();
      const right = parseComparison();
      if (!right.ok) return { ok: false };
      left = { ok: true, value: truthy(left.value) && truthy(right.value) };
    }
    return left;
  }

  /** `or := and { '||' and }` */
  function parseOr(): { ok: true; value: unknown } | { ok: false } {
    let left = parseAnd();
    if (!left.ok) return { ok: false };
    while (peek()?.kind === "op" && peek()?.value === "||") {
      take();
      const right = parseAnd();
      if (!right.ok) return { ok: false };
      left = { ok: true, value: truthy(left.value) || truthy(right.value) };
    }
    return left;
  }

  const result = parseOr();
  if (!result.ok) return null;
  if (cursor !== tokens.length) return null; // trailing junk — reject rather than ignore
  return truthy(result.value);
}

/** CEL-ish truthiness, deliberately narrower than JavaScript's: only `true`, a
 *  non-empty string, a non-zero number and a non-empty array/object are truthy.
 *  `undefined` (an unresolved path) is always falsy, which is what makes an
 *  unsatisfiable branch fall through to the Router's REQUIRED `default`. */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

/** Comparison with strict, non-coercing equality for `==`/`!=` and numeric/lexical
 *  ordering for the four relational operators. Comparing incomparable operands (an
 *  object against a number) yields `false` rather than a type error — the evaluator's
 *  contract is that it always produces a boolean for a well-formed expression. */
function compare(operator: string, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      break;
  }
  if (typeof left === "number" && typeof right === "number") {
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    return left <= right;
  }
  if (typeof left === "string" && typeof right === "string") {
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    return left <= right;
  }
  return false;
}

/**
 * Evaluates a `when` / `whileCondition` expression.
 *
 * @param expression the authored CEL-subset source.
 * @param root the resolution root (the executor passes `{ variables, ... }`).
 * @returns the boolean the expression evaluates to, or `false` if it cannot be parsed.
 *   **Fail-closed by design**: an unparseable condition must not select a Router branch
 *   or continue a Loop. A Router whose branches all evaluate false falls through to its
 *   REQUIRED `default` (V11), so a malformed condition degrades to the authored
 *   default path rather than to a dead end.
 */
export function evaluateCondition(expression: string, root: Record<string, unknown>): boolean {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return false;
  const result = evaluateTokens(tokens, root);
  return result ?? false;
}

/** Whether an expression is well-formed, independent of what it evaluates to. Used
 *  only by tests and diagnostics — the executor itself always takes the fail-closed
 *  `evaluateCondition` path, so a malformed expression can never halt a pump tick. */
export function isParseableCondition(expression: string): boolean {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return false;
  return evaluateTokens(tokens, {}) !== null;
}
