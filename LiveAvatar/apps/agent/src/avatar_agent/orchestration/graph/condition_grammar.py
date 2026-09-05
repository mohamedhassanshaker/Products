"""Router node condition grammar (Phase 9, BL-036) — a small, allow-listed
expression grammar over turn-state fields. Mirrors (not shares — see the
plan doc's "Decisions made this phase")
`apps/api/src/modules/deployment-config/domain/graph-condition.ts`.

**Security discipline (ADR-001 §3's "never `eval`" rule, extended here to
the one new piece of user-influenced dynamic evaluation this phase
introduces to the live agent process):**
- No `eval`, no `exec`, no `ast.literal_eval` on the whole expression, no
  attribute/subscript access into anything but a plain
  `dict[str, str | int | float | bool]` turn-state map.
- Grammar is closed: exactly `<identifier> <op> <literal>`,
  `op ∈ {==, !=, in}`. No boolean combinators, no nesting, no calls.
- An identifier that isn't a key present in `turn_state` evaluates to
  `None`, never raises and never walks any object graph — the "allow-list"
  is turn-state's own keys, populated only by the interpreter.
"""

from __future__ import annotations

import re

TurnStateValue = str | int | float | bool
TurnState = dict[str, TurnStateValue]

_CONDITION_PATTERN = re.compile(r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|in)\s*(\[.*\]|\"[^\"]*\"|'[^']*'|-?\d+(?:\.\d+)?)\s*$")


class GraphConditionError(ValueError):
    """Raised when a condition string doesn't match the closed grammar."""


def _parse_scalar_literal(raw: str) -> TurnStateValue:
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        return raw[1:-1]
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError as err:
        raise GraphConditionError(f"Unsupported literal: '{raw}'.") from err


def _parse_literal(raw: str, op: str) -> TurnStateValue | list[TurnStateValue]:
    if op == "in":
        if not (raw.startswith("[") and raw.endswith("]")):
            raise GraphConditionError(f"'in' requires a bracketed list literal, got '{raw}'.")
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar_literal(part.strip()) for part in inner.split(",")]
    return _parse_scalar_literal(raw)


def evaluate_condition(condition: str, turn_state: TurnState) -> bool:
    """Evaluates a Router branch's `condition` string against `turn_state`.

    @raises GraphConditionError: the condition string doesn't match the
        closed grammar (a config-time defect the builder should have
        caught — surfaced here as a node failure taking `on_error`, never
        silently treated as `false`).
    """
    match = _CONDITION_PATTERN.match(condition)
    if not match:
        raise GraphConditionError(f"Unsupported condition syntax: '{condition}'.")
    field_name, op, raw_literal = match.groups()
    literal = _parse_literal(raw_literal, op)
    value = turn_state.get(field_name)
    if op == "in":
        assert isinstance(literal, list)
        return any(item == value for item in literal)
    equal = value == literal
    return equal if op == "==" else not equal
