"""The loop-back condition grammar — parsing, validation and evaluation."""

from __future__ import annotations

from decimal import Decimal

from shj3_ai.domain.condition_expr import (
    ConditionContext,
    ConditionNodeSnapshot,
    ConditionOperator,
    ConditionPredicate,
    describe,
    evaluate,
    parse,
    resolve_field_spec,
    validate,
)


def _ctx(**overrides: object) -> ConditionContext:
    base: dict[str, object] = {
        "iteration": 1,
        "hop_count": 2,
        "grounding_confidence": 0.4,
        "cost_tokens": 100,
        "cost_micro_aed": 5000,
        "branch_cost_tokens": 50,
        "degraded": False,
        "used_fallback_model": False,
        "last_reply": ConditionNodeSnapshot(
            text="hello world", confidence=Decimal("0.42"), status="Ok", agent_id="agt_1"
        ),
        "node_outputs": {},
    }
    base.update(overrides)
    return ConditionContext(**base)  # type: ignore[arg-type]


class TestParseGrammar:
    def test_parses_a_single_comparison(self) -> None:
        ast = parse("iteration < 3")
        assert ast.or_groups == ((ConditionPredicate("iteration", ConditionOperator.LT, 3.0),),)

    def test_and_binds_tighter_than_or(self) -> None:
        ast = parse("iteration < 3 and hopCount < 5 or degraded == true")
        assert len(ast.or_groups) == 2
        assert len(ast.or_groups[0]) == 2
        assert len(ast.or_groups[1]) == 1

    def test_parses_string_literal(self) -> None:
        ast = parse("lastReply.status == 'Ok'")
        assert ast.or_groups[0][0].value == "Ok"

    def test_parses_contains_operator(self) -> None:
        ast = parse("lastReply.text contains 'refund'")
        assert ast.or_groups[0][0].operator == ConditionOperator.CONTAINS

    def test_parses_boolean_literal(self) -> None:
        ast = parse("degraded == false")
        assert ast.or_groups[0][0].value is False

    def test_parses_templated_node_field(self) -> None:
        ast = parse("node.triage.confidence >= 0.5")
        assert ast.or_groups[0][0].field == "node.triage.confidence"

    def test_rejects_empty_expression(self) -> None:
        try:
            parse("")
            raise AssertionError("expected ConditionSyntaxError")
        except Exception as exc:
            assert exc.issue.code == "condition.condition_empty"  # type: ignore[attr-defined]

    def test_rejects_expression_over_length_limit(self) -> None:
        try:
            parse("iteration < " + "9" * 500)
            raise AssertionError("expected ConditionSyntaxError")
        except Exception as exc:
            assert exc.issue.code == "condition.too_long"  # type: ignore[attr-defined]

    def test_rejects_more_than_eight_predicates(self) -> None:
        expr = " and ".join(f"hopCount < {i}" for i in range(9))
        try:
            parse(expr)
            raise AssertionError("expected ConditionSyntaxError")
        except Exception as exc:
            assert exc.issue.code == "condition.too_many_terms"  # type: ignore[attr-defined]

    def test_rejects_missing_operator(self) -> None:
        try:
            parse("iteration 3")
            raise AssertionError("expected ConditionSyntaxError")
        except Exception as exc:
            assert exc.issue.code == "condition.syntax_error"  # type: ignore[attr-defined]

    def test_rejects_trailing_garbage(self) -> None:
        try:
            parse("iteration < 3 banana")
            raise AssertionError("expected ConditionSyntaxError")
        except Exception as exc:
            assert exc.issue.code == "condition.syntax_error"  # type: ignore[attr-defined]

    def test_rejects_unexpected_character(self) -> None:
        try:
            parse("iteration < 3 & hopCount < 2")
            raise AssertionError("expected ConditionSyntaxError")
        except Exception as exc:
            assert exc.issue.code == "condition.syntax_error"  # type: ignore[attr-defined]


class TestValidate:
    def test_accepts_a_known_field_with_a_compatible_operator(self) -> None:
        assert validate("groundingConfidence < 0.6") == ()

    def test_rejects_unknown_field(self) -> None:
        issues = validate("madeUpField < 3")
        assert [i.code for i in issues] == ["condition.unknown_field"]

    def test_rejects_unknown_templated_node_key(self) -> None:
        issues = validate("node.unknown.confidence >= 0.5", known_node_keys=frozenset({"triage"}))
        assert [i.code for i in issues] == ["condition.unknown_field"]

    def test_accepts_a_known_templated_node_key(self) -> None:
        assert (
            validate("node.triage.confidence >= 0.5", known_node_keys=frozenset({"triage"})) == ()
        )

    def test_rejects_contains_on_a_numeric_field(self) -> None:
        issues = validate("hopCount contains '3'")
        # type_mismatch fires too (a string literal against a numeric field) — both real.
        assert "condition.operator_not_allowed" in [i.code for i in issues]

    def test_rejects_numeric_operator_on_a_text_field(self) -> None:
        issues = validate("lastReply.text < 3")
        # type_mismatch fires too (a float literal against a text field) — both real.
        assert "condition.operator_not_allowed" in [i.code for i in issues]

    def test_rejects_type_mismatch_number_field_string_literal(self) -> None:
        issues = validate("groundingConfidence == 'high'")
        assert [i.code for i in issues] == ["condition.type_mismatch"]

    def test_rejects_type_mismatch_boolean_field_number_literal(self) -> None:
        issues = validate("degraded == 1")
        assert [i.code for i in issues] == ["condition.type_mismatch"]

    def test_syntax_error_short_circuits_to_one_issue(self) -> None:
        issues = validate("")
        assert len(issues) == 1
        assert issues[0].code == "condition.condition_empty"


class TestResolveFieldSpec:
    def test_resolves_a_flat_field(self) -> None:
        assert resolve_field_spec("iteration", None) is not None

    def test_resolves_a_dotted_last_reply_field(self) -> None:
        assert resolve_field_spec("lastReply.confidence", None) is not None

    def test_none_for_an_unknown_field(self) -> None:
        assert resolve_field_spec("notAField", None) is None

    def test_node_field_requires_a_known_key_when_supplied(self) -> None:
        assert resolve_field_spec("node.x.confidence", frozenset({"y"})) is None
        assert resolve_field_spec("node.x.confidence", frozenset({"x"})) is not None

    def test_node_field_accepted_when_no_known_key_set_is_supplied(self) -> None:
        assert resolve_field_spec("node.anything.confidence", None) is not None


class TestEvaluate:
    def test_true_predicate(self) -> None:
        assert evaluate(parse("iteration < 3"), _ctx(iteration=1)) is True

    def test_false_predicate(self) -> None:
        assert evaluate(parse("iteration < 3"), _ctx(iteration=5)) is False

    def test_or_is_true_if_either_group_is_true(self) -> None:
        ast = parse("iteration > 100 or hopCount < 5")
        assert evaluate(ast, _ctx(iteration=1, hop_count=2)) is True

    def test_and_requires_every_predicate_in_the_group(self) -> None:
        ast = parse("iteration < 3 and hopCount < 1")
        assert evaluate(ast, _ctx(iteration=1, hop_count=2)) is False

    def test_contains_on_last_reply_text(self) -> None:
        ast = parse("lastReply.text contains 'world'")
        assert evaluate(ast, _ctx()) is True

    def test_unresolvable_field_evaluates_false_not_error(self) -> None:
        # grounding confidence unset (None) -- the conservative "exit the loop" default.
        ast = parse("groundingConfidence < 0.6")
        assert evaluate(ast, _ctx(grounding_confidence=None)) is False

    def test_no_last_reply_yet_evaluates_false(self) -> None:
        ast = parse("lastReply.confidence >= 0.5")
        assert evaluate(ast, _ctx(last_reply=None)) is False

    def test_templated_node_field_reads_node_outputs(self) -> None:
        ast = parse("node.triage.confidence >= 0.5")
        ctx = _ctx(
            node_outputs={
                "triage": ConditionNodeSnapshot(
                    text="t", confidence=Decimal("0.9"), status="Ok", agent_id="a"
                )
            }
        )
        assert evaluate(ast, ctx) is True

    def test_unknown_templated_node_key_at_runtime_evaluates_false(self) -> None:
        ast = parse("node.missing.confidence >= 0.5")
        assert evaluate(ast, _ctx(node_outputs={})) is False


class TestDescribe:
    def test_round_trips_a_simple_predicate(self) -> None:
        assert describe(parse("iteration < 3")) == "iteration < 3.0"

    def test_normalizes_whitespace(self) -> None:
        assert describe(parse("iteration<3")) == describe(parse("iteration   <   3"))

    def test_renders_and_or_structure(self) -> None:
        text = describe(parse("iteration < 3 and hopCount < 5 or degraded == true"))
        assert text == "iteration < 3.0 and hopCount < 5.0 or degraded == true"
