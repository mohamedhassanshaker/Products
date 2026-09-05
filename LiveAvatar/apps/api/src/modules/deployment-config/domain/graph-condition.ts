/**
 * Router node condition grammar (Phase 9, BL-035/BL-037) — a small,
 * allow-listed expression grammar over turn-state fields, used by the
 * NestJS test-call simulator (`test-call-graph.use-case.ts`). Mirrored,
 * not shared, in Python (`apps/agent/.../orchestration/graph/condition_grammar.py`)
 * for the real interpreter — see the plan doc's "Decisions made this phase"
 * for why duplication was chosen over a cross-language shared parser.
 *
 * **Security discipline (ADR-001 §3's "never `eval`" rule, applied here to
 * the one new piece of user-influenced dynamic evaluation this phase
 * introduces):**
 * - No `eval`, no `new Function`, no dynamic property access into anything
 *   but a plain `Record<string, string | number | boolean>` turn-state map.
 * - Grammar is closed: exactly `<identifier> <op> <literal>`, `op ∈ {==, !=,
 *   in}`. No boolean combinators, no nested expressions, no function calls.
 * - An identifier that isn't a key present in `turnState` evaluates to
 *   `undefined`, never throrws and never walks a prototype chain — the
 *   "allow-list" is turn-state's own keys, which only the interpreter
 *   populates, never the condition string itself.
 */

export type TurnStateValue = string | number | boolean;
export type TurnState = Record<string, TurnStateValue>;

type Op = '==' | '!=' | 'in';

interface ParsedCondition {
  field: string;
  op: Op;
  literal: TurnStateValue | TurnStateValue[];
}

const CONDITION_PATTERN =
  /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|in)\s*(\[.*\]|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)\s*$/;

/** Thrown when a condition string doesn't match the closed grammar. */
export class GraphConditionError extends Error {}

/**
 * Parses a Router branch's `condition` string against the closed grammar.
 * @param condition - Raw `RouterBranchSchema.condition` string
 * @throws GraphConditionError when the string doesn't match the grammar
 */
export function parseCondition(condition: string): ParsedCondition {
  const match = CONDITION_PATTERN.exec(condition);
  if (!match) {
    throw new GraphConditionError(`Unsupported condition syntax: '${condition}'.`);
  }
  const [, field, op, rawLiteral] = match;
  return { field, op: op as Op, literal: parseLiteral(rawLiteral, op as Op) };
}

function parseLiteral(raw: string, op: Op): TurnStateValue | TurnStateValue[] {
  if (op === 'in') {
    if (!raw.startsWith('[') || !raw.endsWith(']')) {
      throw new GraphConditionError(`'in' requires a bracketed list literal, got '${raw}'.`);
    }
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return inner.split(',').map((part) => parseScalarLiteral(part.trim()));
  }
  return parseScalarLiteral(raw);
}

function parseScalarLiteral(raw: string): TurnStateValue {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && raw.trim() !== '') {
    return asNumber;
  }
  throw new GraphConditionError(`Unsupported literal: '${raw}'.`);
}

/**
 * Evaluates a parsed condition against `turnState`. Never throws — an
 * unknown field name simply evaluates to `false` (the field lookup returns
 * `undefined`, which never equals/contains any literal).
 * @param condition - Raw condition string (parsed internally)
 * @param turnState - Flat map of turn-state fields the interpreter populated
 */
export function evaluateCondition(condition: string, turnState: TurnState): boolean {
  const parsed = parseCondition(condition);
  const value = turnState[parsed.field];
  if (parsed.op === 'in') {
    const list = parsed.literal as TurnStateValue[];
    return list.some((item) => item === value);
  }
  const equal = value === parsed.literal;
  return parsed.op === '==' ? equal : !equal;
}
