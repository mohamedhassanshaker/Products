"""Unit tests for the Router condition grammar (Phase 9, BL-036) — the
phase's flagged security-sensitive surface (never `eval`). Mirrors the
TypeScript sibling's coverage
(`apps/api/src/modules/deployment-config/domain/graph-condition.ts`).
"""

from __future__ import annotations

import inspect

import pytest

from avatar_agent.orchestration.graph import condition_grammar
from avatar_agent.orchestration.graph.condition_grammar import GraphConditionError, evaluate_condition

# --- `==` --------------------------------------------------------------


def test_equals_double_quoted_string_literal_matches() -> None:
    assert evaluate_condition('intent == "refund"', {"intent": "refund"}) is True


def test_equals_double_quoted_string_literal_does_not_match() -> None:
    assert evaluate_condition('intent == "refund"', {"intent": "complaint"}) is False


def test_equals_single_quoted_string_literal() -> None:
    assert evaluate_condition("intent == 'refund'", {"intent": "refund"}) is True


def test_equals_integer_literal() -> None:
    assert evaluate_condition("retry_count == 3", {"retry_count": 3}) is True
    assert evaluate_condition("retry_count == 3", {"retry_count": 4}) is False


def test_equals_negative_integer_literal() -> None:
    assert evaluate_condition("delta == -1", {"delta": -1}) is True


def test_equals_float_literal() -> None:
    assert evaluate_condition("score == 0.5", {"score": 0.5}) is True


# --- `!=` --------------------------------------------------------------


def test_not_equals_is_true_when_values_differ() -> None:
    assert evaluate_condition('intent != "refund"', {"intent": "complaint"}) is True


def test_not_equals_is_false_when_values_are_the_same() -> None:
    assert evaluate_condition('intent != "refund"', {"intent": "refund"}) is False


# --- `in` ----------------------------------------------------------------


def test_in_string_list_matches() -> None:
    assert evaluate_condition('intent in ["complaint", "escalation"]', {"intent": "complaint"}) is True


def test_in_string_list_does_not_match() -> None:
    assert evaluate_condition('intent in ["complaint", "escalation"]', {"intent": "refund"}) is False


def test_in_number_list_matches() -> None:
    assert evaluate_condition("tier in [1, 2, 3]", {"tier": 2}) is True


def test_in_empty_list_literal_never_matches() -> None:
    assert evaluate_condition("intent in []", {"intent": "refund"}) is False


def test_in_with_a_non_list_literal_raises() -> None:
    with pytest.raises(GraphConditionError):
        evaluate_condition('intent in "refund"', {"intent": "refund"})


# --- unknown field: evaluates as if the value is `None`, never raises --


def test_unknown_field_with_equals_returns_false_never_raises() -> None:
    assert evaluate_condition('unknown_field == "x"', {}) is False


def test_unknown_field_with_not_equals_returns_true_never_raises() -> None:
    assert evaluate_condition('unknown_field != "x"', {}) is True


def test_unknown_field_with_in_returns_false_never_raises() -> None:
    assert evaluate_condition('unknown_field in ["x", "y"]', {}) is False


# --- malformed syntax: raises GraphConditionError, never silently False --


@pytest.mark.parametrize(
    "condition",
    [
        "",
        "intent",
        "intent ==",
        'intent === "x"',
        'intent >< "x"',
        '1intent == "x"',
        "intent == unquoted",
        "intent in [unclosed",
        "__import__('os') == \"x\"",
        'intent == "x"; import os',
    ],
)
def test_malformed_condition_raises_graph_condition_error(condition: str) -> None:
    with pytest.raises(GraphConditionError):
        evaluate_condition(condition, {"intent": "x"})


# --- security: no eval/exec/ast.literal_eval anywhere in this module ----


def test_module_never_evals_or_execs_the_raw_condition_string() -> None:
    """Belt-and-suspenders static check (ADR-001 §3's "never eval" rule) on
    top of the behavioral coverage above — the grammar must never fall back
    to `eval`/`exec`/`ast.literal_eval` on the whole condition string.
    """
    source = inspect.getsource(condition_grammar)
    assert "eval(" not in source
    assert "exec(" not in source
    assert "literal_eval(" not in source
