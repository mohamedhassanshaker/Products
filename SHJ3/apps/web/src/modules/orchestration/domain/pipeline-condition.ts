/**
 * The loop-back condition grammar — the client-side twin of `apps/ai`'s
 * `domain/condition_expr.py`. A grammar maintained in two languages drifts, so this file
 * is a deliberate structural port of that one (same tokens, same recursive-descent shape,
 * same field table BY NAME), not an independent design — kept for fast, save-time
 * client-side validation and canvas rendering; the AI-side module remains the sole
 * runtime evaluator and the authoritative gate (`POST /v1/orchestration/pipelines/
 * validate-condition`), since a condition that only this copy accepts would be a lie the
 * moment the pipeline actually runs.
 *
 * Grammar (identical to the Python side — no parentheses, no nesting, no arithmetic):
 *
 *     expr       := andExpr ("or" andExpr)*        # `and` binds tighter than `or`
 *     andExpr    := comparison ("and" comparison)*
 *     comparison := field op literal
 *     field      := IDENT ( "." IDENT ){0,2}
 *     op         := "<" | "<=" | ">" | ">=" | "==" | "!=" | "contains"
 *     literal    := NUMBER | 'single-quoted string' | "true" | "false"
 */

export const MAX_CONDITION_LENGTH = 500;
export const MAX_PREDICATES = 8;

export type FieldType = "number" | "text" | "boolean";

export const PIPELINE_CONDITION_OPERATORS = [
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "contains",
] as const;
export type ConditionOperator = (typeof PIPELINE_CONDITION_OPERATORS)[number];

const NUMERIC_ONLY_OPERATORS: ReadonlySet<ConditionOperator> = new Set(["<", "<=", ">", ">="]);

export interface FieldSpec {
  readonly fieldType: FieldType;
}

/** The closed variable set a loop condition may reference — a contract shared BY NAME
 *  with the Python `FIELD_SPECS`. A field added on one side without the other is meant to
 *  fail a `tests/contract/` test, not silently mismatch. */
export const PIPELINE_CONDITION_VARIABLES: Readonly<Record<string, FieldSpec>> = {
  iteration: { fieldType: "number" },
  hopCount: { fieldType: "number" },
  groundingConfidence: { fieldType: "number" },
  costTokens: { fieldType: "number" },
  costMicroAed: { fieldType: "number" },
  branchCostTokens: { fieldType: "number" },
  degraded: { fieldType: "boolean" },
  usedFallbackModel: { fieldType: "boolean" },
  "lastReply.text": { fieldType: "text" },
  "lastReply.confidence": { fieldType: "number" },
  "lastReply.agentId": { fieldType: "text" },
  "lastReply.status": { fieldType: "text" },
};

const NODE_FIELD_SUFFIXES: Readonly<Record<string, FieldType>> = {
  text: "text",
  confidence: "number",
  status: "text",
  agentId: "text",
};

/** `undefined` when `fieldName` is not a real, resolvable field — the single point both
 *  `validate()` and the runtime resolver agree with. */
export function resolveFieldSpec(
  fieldName: string,
  knownNodeKeys: ReadonlySet<string> | undefined,
): FieldSpec | undefined {
  const spec = PIPELINE_CONDITION_VARIABLES[fieldName];
  if (spec !== undefined) return spec;
  const parts = fieldName.split(".");
  if (
    parts.length === 3 &&
    parts[0] === "node" &&
    parts[2] !== undefined &&
    parts[2] in NODE_FIELD_SUFFIXES &&
    (knownNodeKeys === undefined || (parts[1] !== undefined && knownNodeKeys.has(parts[1])))
  ) {
    return { fieldType: NODE_FIELD_SUFFIXES[parts[2]] as FieldType };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// AST.
// ---------------------------------------------------------------------------

export interface ConditionPredicate {
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: number | string | boolean;
}

/** `OR` of `AND`-groups (sum-of-products) — true iff any group is fully true. */
export interface ConditionAst {
  readonly orGroups: readonly (readonly ConditionPredicate[])[];
}

export interface ConditionIssue {
  readonly code: string;
  readonly position: number;
  readonly message: string;
  readonly token?: string;
}

export class ConditionSyntaxError extends Error {
  readonly issue: ConditionIssue;
  constructor(issue: ConditionIssue) {
    super(issue.message);
    this.issue = issue;
  }
}

// ---------------------------------------------------------------------------
// Tokenizer.
// ---------------------------------------------------------------------------

type TokenKind = "op" | "string" | "number" | "word";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly position: number;
}

const TOKEN_PATTERN =
  /\s+|(<=|>=|==|!=|<|>)|('(?:[^'\\]|\\.)*')|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)/y;

function tokenize(expression: string): readonly Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < expression.length) {
    TOKEN_PATTERN.lastIndex = pos;
    const match = TOKEN_PATTERN.exec(expression);
    if (match === null || match.index !== pos) {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: pos,
        message: `Unexpected character '${expression[pos]}' at position ${pos}.`,
        token: expression[pos]!,
      });
    }
    const [whole, op, string, number, word] = match;
    pos += whole.length;
    if (op !== undefined) tokens.push({ kind: "op", text: op, position: match.index });
    else if (string !== undefined) tokens.push({ kind: "string", text: string, position: match.index });
    else if (number !== undefined) tokens.push({ kind: "number", text: number, position: match.index });
    else if (word !== undefined) tokens.push({ kind: "word", text: word, position: match.index });
    // else: pure whitespace match, nothing to push.
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser.
// ---------------------------------------------------------------------------

const RESERVED_WORDS: ReadonlySet<string> = new Set(["and", "or", "true", "false"]);

class Parser {
  private index = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private advance(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: 0,
        message: "Unexpected end of expression.",
      });
    }
    this.index += 1;
    return token;
  }

  parseExpr(): ConditionAst {
    const groups = [this.parseAndGroup()];
    let tok = this.peek();
    while (tok !== undefined && tok.kind === "word" && tok.text.toLowerCase() === "or") {
      this.advance();
      groups.push(this.parseAndGroup());
      tok = this.peek();
    }
    const trailing = this.peek();
    if (trailing !== undefined) {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: trailing.position,
        message: `Unexpected token '${trailing.text}'.`,
        token: trailing.text,
      });
    }
    return { orGroups: groups };
  }

  private parseAndGroup(): readonly ConditionPredicate[] {
    const predicates = [this.parseComparison()];
    let tok = this.peek();
    while (tok !== undefined && tok.kind === "word" && tok.text.toLowerCase() === "and") {
      this.advance();
      predicates.push(this.parseComparison());
      tok = this.peek();
    }
    return predicates;
  }

  private parseComparison(): ConditionPredicate {
    const fieldTok = this.peek();
    if (fieldTok === undefined || fieldTok.kind !== "word" || RESERVED_WORDS.has(fieldTok.text.toLowerCase())) {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: fieldTok?.position ?? 0,
        message: "Expected a field name.",
        ...(fieldTok !== undefined ? { token: fieldTok.text } : {}),
      });
    }
    this.advance();

    const opTok = this.peek();
    if (opTok === undefined) {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: fieldTok.position + fieldTok.text.length,
        message: "Expected a comparison operator after the field name.",
      });
    }
    let operator: ConditionOperator;
    if (opTok.kind === "op") {
      operator = opTok.text as ConditionOperator;
    } else if (opTok.kind === "word" && opTok.text.toLowerCase() === "contains") {
      operator = "contains";
    } else {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: opTok.position,
        message: `Expected a comparison operator, found '${opTok.text}'.`,
        token: opTok.text,
      });
    }
    this.advance();

    const literalTok = this.peek();
    if (literalTok === undefined) {
      throw new ConditionSyntaxError({
        code: "condition.syntax_error",
        position: opTok.position + opTok.text.length,
        message: "Expected a value after the operator.",
      });
    }
    const value = this.parseLiteral(literalTok);
    this.advance();
    return { field: fieldTok.text, operator, value };
  }

  private parseLiteral(token: Token): number | string | boolean {
    if (token.kind === "number") return Number.parseFloat(token.text);
    if (token.kind === "string") return token.text.slice(1, -1).replace(/\\'/g, "'");
    if (token.kind === "word" && (token.text.toLowerCase() === "true" || token.text.toLowerCase() === "false")) {
      return token.text.toLowerCase() === "true";
    }
    throw new ConditionSyntaxError({
      code: "condition.syntax_error",
      position: token.position,
      message: `Expected a value, found '${token.text}'.`,
      token: token.text,
    });
  }
}

/** Syntax only — field/operator/type validity is `validate()`'s job, since that needs
 *  `knownNodeKeys` this function deliberately doesn't take. Throws `ConditionSyntaxError`. */
export function parse(expression: string): ConditionAst {
  if (expression.length === 0) {
    throw new ConditionSyntaxError({
      code: "condition.condition_empty",
      position: 0,
      message: "A condition cannot be empty.",
    });
  }
  if (expression.length > MAX_CONDITION_LENGTH) {
    throw new ConditionSyntaxError({
      code: "condition.too_long",
      position: MAX_CONDITION_LENGTH,
      message: `A condition may be at most ${MAX_CONDITION_LENGTH} characters.`,
    });
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new ConditionSyntaxError({
      code: "condition.condition_empty",
      position: 0,
      message: "A condition cannot be empty.",
    });
  }
  const ast = new Parser(tokens).parseExpr();
  const totalPredicates = ast.orGroups.reduce((sum, group) => sum + group.length, 0);
  if (totalPredicates > MAX_PREDICATES) {
    throw new ConditionSyntaxError({
      code: "condition.too_many_terms",
      position: 0,
      message: `A condition may have at most ${MAX_PREDICATES} comparisons.`,
    });
  }
  return ast;
}

/** Syntax (via `parse`) plus field/operator/type semantics — the real save-time gate.
 *  Never throws. A syntax failure short-circuits with exactly one issue; a syntactically
 *  valid expression can still fail with one issue per bad predicate. */
export function validate(
  expression: string,
  knownNodeKeys: ReadonlySet<string> | undefined = undefined,
): readonly ConditionIssue[] {
  let ast: ConditionAst;
  try {
    ast = parse(expression);
  } catch (error) {
    if (error instanceof ConditionSyntaxError) return [error.issue];
    throw error;
  }

  const issues: ConditionIssue[] = [];
  for (const group of ast.orGroups) {
    for (const predicate of group) {
      const spec = resolveFieldSpec(predicate.field, knownNodeKeys);
      if (spec === undefined) {
        issues.push({
          code: "condition.unknown_field",
          position: 0,
          message: `Unknown field '${predicate.field}'.`,
          token: predicate.field,
        });
        continue;
      }
      if (predicate.operator === "contains" && spec.fieldType !== "text") {
        issues.push({
          code: "condition.operator_not_allowed",
          position: 0,
          message: `'contains' is only allowed on text fields, not '${predicate.field}'.`,
          token: predicate.field,
        });
      } else if (NUMERIC_ONLY_OPERATORS.has(predicate.operator) && spec.fieldType !== "number") {
        issues.push({
          code: "condition.operator_not_allowed",
          position: 0,
          message: `'${predicate.operator}' is only allowed on numeric fields, not '${predicate.field}'.`,
          token: predicate.field,
        });
      }
      const expectedJsType = { number: "number", boolean: "boolean", text: "string" }[spec.fieldType];
      if (typeof predicate.value !== expectedJsType) {
        issues.push({
          code: "condition.type_mismatch",
          position: 0,
          message: `'${predicate.field}' expects a ${spec.fieldType} value.`,
          token: predicate.field,
        });
      }
    }
  }
  return issues;
}

/** Canonical re-render — both the persisted *normalized* string (so `confidence&lt;0.6`
 *  and `confidence < 0.6` are stored identically) and the trace step's human-readable
 *  label are this same function's output. */
export function describe(ast: ConditionAst): string {
  function describePredicate(predicate: ConditionPredicate): string {
    const value =
      typeof predicate.value === "boolean"
        ? String(predicate.value)
        : typeof predicate.value === "string"
          ? `'${predicate.value}'`
          : String(predicate.value);
    return `${predicate.field} ${predicate.operator} ${value}`;
  }
  return ast.orGroups.map((group) => group.map(describePredicate).join(" and ")).join(" or ");
}

// ---------------------------------------------------------------------------
// Evaluation — used by the trace-preview panel to render a would-be loop decision
// client-side; the AI side remains the authoritative evaluator at real request time.
// ---------------------------------------------------------------------------

export interface ConditionNodeSnapshot {
  readonly text: string;
  readonly confidence: number | null;
  readonly status: string;
  readonly agentId: string | null;
}

export interface ConditionContext {
  readonly iteration: number;
  readonly hopCount: number;
  readonly groundingConfidence: number | null;
  readonly costTokens: number;
  readonly costMicroAed: number;
  readonly branchCostTokens: number;
  readonly degraded: boolean;
  readonly usedFallbackModel: boolean;
  readonly lastReply: ConditionNodeSnapshot | null;
  readonly nodeOutputs: Readonly<Record<string, ConditionNodeSnapshot>>;
}

function snapshotValue(snapshot: ConditionNodeSnapshot, suffix: string): number | string | boolean | null {
  if (suffix === "text") return snapshot.text;
  if (suffix === "status") return snapshot.status;
  if (suffix === "agentId") return snapshot.agentId;
  if (suffix === "confidence") return snapshot.confidence;
  return null;
}

function resolveValue(fieldName: string, ctx: ConditionContext): number | string | boolean | null {
  switch (fieldName) {
    case "iteration":
      return ctx.iteration;
    case "hopCount":
      return ctx.hopCount;
    case "groundingConfidence":
      return ctx.groundingConfidence;
    case "costTokens":
      return ctx.costTokens;
    case "costMicroAed":
      return ctx.costMicroAed;
    case "branchCostTokens":
      return ctx.branchCostTokens;
    case "degraded":
      return ctx.degraded;
    case "usedFallbackModel":
      return ctx.usedFallbackModel;
    default:
      break;
  }
  if (fieldName.startsWith("lastReply.")) {
    if (ctx.lastReply === null) return null;
    return snapshotValue(ctx.lastReply, fieldName.split(".", 2)[1] ?? "");
  }
  const parts = fieldName.split(".");
  if (parts.length === 3 && parts[0] === "node" && parts[1] !== undefined && parts[2] !== undefined) {
    const snapshot = ctx.nodeOutputs[parts[1]];
    if (snapshot === undefined) return null;
    return snapshotValue(snapshot, parts[2]);
  }
  return null;
}

function evaluatePredicate(predicate: ConditionPredicate, ctx: ConditionContext): boolean {
  const value = resolveValue(predicate.field, ctx);
  if (value === null) return false;
  if (predicate.operator === "contains") {
    return typeof value === "string" && typeof predicate.value === "string" && value.includes(predicate.value);
  }
  if (predicate.operator === "==") return value === predicate.value;
  if (predicate.operator === "!=") return value !== predicate.value;
  if (typeof value !== "number" || typeof predicate.value !== "number") return false;
  if (predicate.operator === "<") return value < predicate.value;
  if (predicate.operator === "<=") return value <= predicate.value;
  if (predicate.operator === ">") return value > predicate.value;
  if (predicate.operator === ">=") return value >= predicate.value;
  return false;
}

/** Never throws — an internal failure is caught and treated as `false`, the same
 *  fail-closed direction as an unresolvable field. */
export function evaluate(ast: ConditionAst, ctx: ConditionContext): boolean {
  try {
    return ast.orGroups.some((group) => group.every((predicate) => evaluatePredicate(predicate, ctx)));
  } catch {
    return false;
  }
}
