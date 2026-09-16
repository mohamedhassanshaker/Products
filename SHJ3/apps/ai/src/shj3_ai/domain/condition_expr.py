"""
The loop-back condition grammar — a small, whitelisted comparison-expression language,
built for real this wave rather than deferred: `PipelineEdge.maxIterations` alone gives
a bounded-but-useless loop (always exactly N passes); the two loop mechanisms only make
sense together, per the explicit product decision behind this feature.

This is deliberately NOT `eval()` of arbitrary Python, and deliberately NOT a general
expression language with parentheses, arithmetic or function calls. The actual safety
property is `FIELD_SPECS`: a closed table of named, typed fields resolved against a
frozen `ConditionContext` snapshot — there is no attribute lookup on a live object and
no identifier that isn't in this table. An unknown field is a *validation*-time error
(`validate()`), never a runtime lookup failure.

Grammar (no parentheses, no nesting, no arithmetic, no cross-field comparisons — an
admin authors these, a Python evaluator on the other side of a network boundary runs
them, and neither side benefits from an expression language nobody can fully audit):

    expr       := andExpr ("or" andExpr)*        # `and` binds tighter than `or`
    andExpr    := comparison ("and" comparison)*
    comparison := field op literal
    field      := IDENT ( "." IDENT ){0,2}
    op         := "<" | "<=" | ">" | ">=" | "==" | "!=" | "contains"
    literal    := NUMBER | 'single-quoted string' | "true" | "false"

`parse()` is implemented once, here, and exposed over HTTP
(`POST /v1/orchestration/pipelines/validate-condition`) for the web side to call for
save-time validation — a grammar maintained in two languages drifts, and drift here
means a condition an admin's client accepted and this interpreter refuses.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

MAX_CONDITION_LENGTH = 500
MAX_PREDICATES = 8


class FieldType(StrEnum):
    NUMBER = "number"
    TEXT = "text"
    BOOLEAN = "boolean"


class ConditionOperator(StrEnum):
    LT = "<"
    LTE = "<="
    GT = ">"
    GTE = ">="
    EQ = "=="
    NE = "!="
    CONTAINS = "contains"


_NUMERIC_ONLY_OPERATORS = frozenset(
    {ConditionOperator.LT, ConditionOperator.LTE, ConditionOperator.GT, ConditionOperator.GTE}
)


@dataclass(frozen=True, slots=True)
class FieldSpec:
    field_type: FieldType


#: The closed variable set a loop condition may reference. This exact name list is a
#: contract shared BY NAME with the TypeScript `PIPELINE_CONDITION_VARIABLES` — a field
#: added on one side without the other is meant to fail a `tests/contract/` test, not
#: silently mismatch (a condition the designer accepted on save that this interpreter
#: cannot resolve at run time).
FIELD_SPECS: Mapping[str, FieldSpec] = {
    "iteration": FieldSpec(FieldType.NUMBER),
    "hopCount": FieldSpec(FieldType.NUMBER),
    "groundingConfidence": FieldSpec(FieldType.NUMBER),
    "costTokens": FieldSpec(FieldType.NUMBER),
    "costMicroAed": FieldSpec(FieldType.NUMBER),
    "branchCostTokens": FieldSpec(FieldType.NUMBER),
    "degraded": FieldSpec(FieldType.BOOLEAN),
    "usedFallbackModel": FieldSpec(FieldType.BOOLEAN),
    "lastReply.text": FieldSpec(FieldType.TEXT),
    "lastReply.confidence": FieldSpec(FieldType.NUMBER),
    "lastReply.agentId": FieldSpec(FieldType.TEXT),
    "lastReply.status": FieldSpec(FieldType.TEXT),
}

#: The templated `node.<key>.<suffix>` family — validated against the pipeline
#: version's own real node keys at save/validate time (`known_node_keys`), never
#: accepted for an unknown key.
_NODE_FIELD_SUFFIXES: Mapping[str, FieldType] = {
    "text": FieldType.TEXT,
    "confidence": FieldType.NUMBER,
    "status": FieldType.TEXT,
    "agentId": FieldType.TEXT,
}


def resolve_field_spec(field_name: str, known_node_keys: frozenset[str] | None) -> FieldSpec | None:
    """`None` when `field_name` is not a real, resolvable field — the single point both
    `validate()` and the runtime resolver agree with."""
    spec = FIELD_SPECS.get(field_name)
    if spec is not None:
        return spec
    parts = field_name.split(".")
    if (
        len(parts) == 3
        and parts[0] == "node"
        and parts[2] in _NODE_FIELD_SUFFIXES
        and (known_node_keys is None or parts[1] in known_node_keys)
    ):
        return FieldSpec(_NODE_FIELD_SUFFIXES[parts[2]])
    return None


# ---------------------------------------------------------------------------
# AST.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ConditionPredicate:
    field: str
    operator: ConditionOperator
    value: float | str | bool


@dataclass(frozen=True, slots=True)
class ConditionAst:
    """`OR` of `AND`-groups (sum-of-products) — true iff ANY group is fully true."""

    or_groups: tuple[tuple[ConditionPredicate, ...], ...]


@dataclass(frozen=True, slots=True)
class ConditionIssue:
    code: str
    position: int
    message: str
    token: str | None = None


class ConditionSyntaxError(Exception):
    def __init__(self, issue: ConditionIssue) -> None:
        self.issue = issue
        super().__init__(issue.message)


# ---------------------------------------------------------------------------
# Tokenizer.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Token:
    kind: str  # "op" | "string" | "number" | "word"
    text: str
    position: int


_TOKEN_PATTERN = re.compile(
    r"""
      (?P<ws>\s+)
    | (?P<op><=|>=|==|!=|<|>)
    | (?P<string>'(?:[^'\\]|\\.)*')
    | (?P<number>-?\d+(?:\.\d+)?)
    | (?P<word>[A-Za-z_][A-Za-z0-9_.]*)
    """,
    re.VERBOSE,
)


def _tokenize(expression: str) -> list[_Token]:
    tokens: list[_Token] = []
    pos = 0
    length = len(expression)
    while pos < length:
        match = _TOKEN_PATTERN.match(expression, pos)
        if match is None:
            raise ConditionSyntaxError(
                ConditionIssue(
                    code="condition.syntax_error",
                    position=pos,
                    message=f"Unexpected character '{expression[pos]}' at position {pos}.",
                    token=expression[pos],
                )
            )
        if match.group("ws") is not None:
            pos = match.end()
            continue
        kind = match.lastgroup
        if kind is None:
            # Unreachable given the pattern above (every alternative is a named
            # group), but keeps this a real branch rather than an `assert` in
            # library code (`S101` is enforced outside `tests/`).
            pos = match.end()
            continue
        tokens.append(_Token(kind=kind, text=match.group(kind), position=match.start()))
        pos = match.end()
    return tokens


# ---------------------------------------------------------------------------
# Recursive-descent parser.
# ---------------------------------------------------------------------------

_RESERVED_WORDS = frozenset({"and", "or", "true", "false"})


class _Parser:
    def __init__(self, tokens: Sequence[_Token]) -> None:
        self._tokens = tokens
        self._index = 0

    def _peek(self) -> _Token | None:
        return self._tokens[self._index] if self._index < len(self._tokens) else None

    def _advance(self) -> _Token:
        token = self._tokens[self._index]
        self._index += 1
        return token

    def parse_expr(self) -> ConditionAst:
        groups = [self._parse_and_group()]
        while (tok := self._peek()) is not None and tok.kind == "word" and tok.text.lower() == "or":
            self._advance()
            groups.append(self._parse_and_group())
        trailing = self._peek()
        if trailing is not None:
            raise ConditionSyntaxError(
                ConditionIssue(
                    code="condition.syntax_error",
                    position=trailing.position,
                    message=f"Unexpected token '{trailing.text}'.",
                    token=trailing.text,
                )
            )
        return ConditionAst(or_groups=tuple(groups))

    def _parse_and_group(self) -> tuple[ConditionPredicate, ...]:
        predicates = [self._parse_comparison()]
        while (
            (tok := self._peek()) is not None and tok.kind == "word" and tok.text.lower() == "and"
        ):
            self._advance()
            predicates.append(self._parse_comparison())
        return tuple(predicates)

    def _parse_comparison(self) -> ConditionPredicate:
        field_tok = self._peek()
        if (
            field_tok is None
            or field_tok.kind != "word"
            or field_tok.text.lower() in _RESERVED_WORDS
        ):
            position = field_tok.position if field_tok is not None else 0
            token = field_tok.text if field_tok is not None else None
            raise ConditionSyntaxError(
                ConditionIssue(
                    code="condition.syntax_error",
                    position=position,
                    message="Expected a field name.",
                    token=token,
                )
            )
        self._advance()

        op_tok = self._peek()
        if op_tok is None:
            raise ConditionSyntaxError(
                ConditionIssue(
                    code="condition.syntax_error",
                    position=field_tok.position + len(field_tok.text),
                    message="Expected a comparison operator after the field name.",
                )
            )
        if op_tok.kind == "op":
            operator = ConditionOperator(op_tok.text)
        elif op_tok.kind == "word" and op_tok.text.lower() == "contains":
            operator = ConditionOperator.CONTAINS
        else:
            raise ConditionSyntaxError(
                ConditionIssue(
                    code="condition.syntax_error",
                    position=op_tok.position,
                    message=f"Expected a comparison operator, found '{op_tok.text}'.",
                    token=op_tok.text,
                )
            )
        self._advance()

        literal_tok = self._peek()
        if literal_tok is None:
            raise ConditionSyntaxError(
                ConditionIssue(
                    code="condition.syntax_error",
                    position=op_tok.position + len(op_tok.text),
                    message="Expected a value after the operator.",
                )
            )
        value = self._parse_literal(literal_tok)
        self._advance()
        return ConditionPredicate(field=field_tok.text, operator=operator, value=value)

    def _parse_literal(self, token: _Token) -> float | str | bool:
        if token.kind == "number":
            return float(token.text)
        if token.kind == "string":
            return token.text[1:-1].replace("\\'", "'")
        if token.kind == "word" and token.text.lower() in ("true", "false"):
            return token.text.lower() == "true"
        raise ConditionSyntaxError(
            ConditionIssue(
                code="condition.syntax_error",
                position=token.position,
                message=f"Expected a value, found '{token.text}'.",
                token=token.text,
            )
        )


def parse(expression: str) -> ConditionAst:
    """Syntax only — field/operator/type validity is `validate()`'s job, since that
    needs `known_node_keys` this function deliberately doesn't take."""
    if len(expression) == 0:
        raise ConditionSyntaxError(
            ConditionIssue(
                code="condition.condition_empty", position=0, message="A condition cannot be empty."
            )
        )
    if len(expression) > MAX_CONDITION_LENGTH:
        raise ConditionSyntaxError(
            ConditionIssue(
                code="condition.too_long",
                position=MAX_CONDITION_LENGTH,
                message=f"A condition may be at most {MAX_CONDITION_LENGTH} characters.",
            )
        )
    tokens = _tokenize(expression)
    if not tokens:
        raise ConditionSyntaxError(
            ConditionIssue(
                code="condition.condition_empty", position=0, message="A condition cannot be empty."
            )
        )
    ast = _Parser(tokens).parse_expr()
    total_predicates = sum(len(group) for group in ast.or_groups)
    if total_predicates > MAX_PREDICATES:
        raise ConditionSyntaxError(
            ConditionIssue(
                code="condition.too_many_terms",
                position=0,
                message=f"A condition may have at most {MAX_PREDICATES} comparisons.",
            )
        )
    return ast


def validate(
    expression: str, *, known_node_keys: frozenset[str] = frozenset()
) -> tuple[ConditionIssue, ...]:
    """Syntax (via `parse`) plus field/operator/type semantics — the real save-time gate.
    A syntax failure short-circuits with exactly one issue; a syntactically valid
    expression can still fail with one issue per bad predicate."""
    try:
        ast = parse(expression)
    except ConditionSyntaxError as exc:
        return (exc.issue,)

    issues: list[ConditionIssue] = []
    for group in ast.or_groups:
        for predicate in group:
            spec = resolve_field_spec(predicate.field, known_node_keys)
            if spec is None:
                issues.append(
                    ConditionIssue(
                        code="condition.unknown_field",
                        position=0,
                        message=f"Unknown field '{predicate.field}'.",
                        token=predicate.field,
                    )
                )
                continue
            if (
                predicate.operator == ConditionOperator.CONTAINS
                and spec.field_type != FieldType.TEXT
            ):
                issues.append(
                    ConditionIssue(
                        code="condition.operator_not_allowed",
                        position=0,
                        message=f"'contains' is only allowed on text fields, not '{predicate.field}'.",
                        token=predicate.field,
                    )
                )
            elif (
                predicate.operator in _NUMERIC_ONLY_OPERATORS
                and spec.field_type != FieldType.NUMBER
            ):
                issues.append(
                    ConditionIssue(
                        code="condition.operator_not_allowed",
                        position=0,
                        message=f"'{predicate.operator.value}' is only allowed on numeric fields, not '{predicate.field}'.",
                        token=predicate.field,
                    )
                )
            expected_value_type: type = {
                FieldType.NUMBER: float,
                FieldType.BOOLEAN: bool,
                FieldType.TEXT: str,
            }[spec.field_type]
            if not isinstance(predicate.value, expected_value_type):
                issues.append(
                    ConditionIssue(
                        code="condition.type_mismatch",
                        position=0,
                        message=f"'{predicate.field}' expects a {spec.field_type.value} value.",
                        token=predicate.field,
                    )
                )
    return tuple(issues)


def describe(ast: ConditionAst) -> str:
    """Canonical re-render — both the persisted *normalized* string (so
    `confidence&lt;0.6` and `confidence < 0.6` are stored identically) and the trace
    step's human-readable label are this same function's output."""

    def describe_predicate(predicate: ConditionPredicate) -> str:
        if isinstance(predicate.value, bool):
            value = "true" if predicate.value else "false"
        elif isinstance(predicate.value, str):
            value = f"'{predicate.value}'"
        else:
            value = str(predicate.value)
        return f"{predicate.field} {predicate.operator.value} {value}"

    groups = [" and ".join(describe_predicate(p) for p in group) for group in ast.or_groups]
    return " or ".join(groups)


# ---------------------------------------------------------------------------
# Evaluation.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ConditionNodeSnapshot:
    text: str
    confidence: Decimal | None
    status: str
    agent_id: str | None


@dataclass(frozen=True, slots=True)
class ConditionContext:
    """The live per-turn state a loop condition may read. Built fresh by the
    interpreter before each loop decision — never mutated, never shared across
    turns."""

    iteration: int
    hop_count: int
    grounding_confidence: float | None
    cost_tokens: int
    cost_micro_aed: int
    branch_cost_tokens: int
    degraded: bool
    used_fallback_model: bool
    last_reply: ConditionNodeSnapshot | None
    node_outputs: Mapping[str, ConditionNodeSnapshot]


def _resolve_value(field_name: str, ctx: ConditionContext) -> float | str | bool | None:
    """Resolves a validated field name against `ctx`. Never raises — an unresolvable
    field (a `None` snapshot, e.g. no reply has happened yet) returns `None`, which
    `_evaluate_predicate` treats as `False` — the conservative direction: a missing
    value biases a loop toward EXITING, never toward extending it further."""
    if field_name == "iteration":
        return float(ctx.iteration)
    if field_name == "hopCount":
        return float(ctx.hop_count)
    if field_name == "groundingConfidence":
        return ctx.grounding_confidence
    if field_name == "costTokens":
        return float(ctx.cost_tokens)
    if field_name == "costMicroAed":
        return float(ctx.cost_micro_aed)
    if field_name == "branchCostTokens":
        return float(ctx.branch_cost_tokens)
    if field_name == "degraded":
        return ctx.degraded
    if field_name == "usedFallbackModel":
        return ctx.used_fallback_model
    if field_name.startswith("lastReply."):
        if ctx.last_reply is None:
            return None
        return _snapshot_value(ctx.last_reply, field_name.split(".", 1)[1])
    parts = field_name.split(".")
    if len(parts) == 3 and parts[0] == "node":
        snapshot = ctx.node_outputs.get(parts[1])
        if snapshot is None:
            return None
        return _snapshot_value(snapshot, parts[2])
    return None


def _snapshot_value(snapshot: ConditionNodeSnapshot, suffix: str) -> float | str | bool | None:
    if suffix == "text":
        return snapshot.text
    if suffix == "status":
        return snapshot.status
    if suffix == "agentId":
        return snapshot.agent_id
    if suffix == "confidence":
        return float(snapshot.confidence) if snapshot.confidence is not None else None
    return None


def _evaluate_predicate(predicate: ConditionPredicate, ctx: ConditionContext) -> bool:
    value = _resolve_value(predicate.field, ctx)
    if value is None:
        return False
    if predicate.operator == ConditionOperator.CONTAINS:
        return (
            isinstance(value, str) and isinstance(predicate.value, str) and predicate.value in value
        )
    if predicate.operator == ConditionOperator.EQ:
        return value == predicate.value
    if predicate.operator == ConditionOperator.NE:
        return value != predicate.value
    # LT/LTE/GT/GTE only ever apply to two real (non-boolean) numbers — `validate()`
    # already rejects a numeric operator against a non-numeric field at save time, but
    # this function stays defensive at run time too, narrowing explicitly rather than
    # relying on a caught `TypeError` so mypy can prove every comparison below is
    # actually well-typed.
    if not (isinstance(value, float) and isinstance(predicate.value, float)):
        return False
    if predicate.operator == ConditionOperator.LT:
        return value < predicate.value
    if predicate.operator == ConditionOperator.LTE:
        return value <= predicate.value
    if predicate.operator == ConditionOperator.GT:
        return value > predicate.value
    return value >= predicate.value


def evaluate(ast: ConditionAst, ctx: ConditionContext) -> bool:
    """Never raises — an internal failure is caught and treated as `False`, the same
    fail-closed direction as an unresolvable field. `OR` of `AND`-groups: true iff any
    group's every predicate is true."""
    try:
        return any(all(_evaluate_predicate(p, ctx) for p in group) for group in ast.or_groups)
    except Exception:
        return False
