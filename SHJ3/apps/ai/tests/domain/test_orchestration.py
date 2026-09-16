"""Pure orchestration logic — B4's ceilings, merge policy and routing score."""

from __future__ import annotations

from decimal import Decimal

from shj3_ai.domain.orchestration import (
    AgentReply,
    Budget,
    ConflictResolution,
    CostLedger,
    ExecutionMode,
    MergePolicy,
    ModelCallCost,
    RoutingCandidate,
    cost_ceiling_reached,
    filter_candidates_by_scope,
    hop_ceiling_reached,
    loop_detected,
    merge_replies,
    route,
)


def _budget(**overrides: object) -> Budget:
    base: dict[str, object] = {
        "max_hops": 4,
        "max_loop_iterations": 3,
        "cost_ceiling_tokens": 1000,
        "cost_ceiling_micro_aed": 50_000,
    }
    base.update(overrides)
    return Budget(**base)  # type: ignore[arg-type]


class TestCeilings:
    def test_hop_ceiling_not_reached_below_max(self) -> None:
        assert not hop_ceiling_reached(3, _budget(max_hops=4))

    def test_hop_ceiling_reached_at_max(self) -> None:
        assert hop_ceiling_reached(4, _budget(max_hops=4))

    def test_loop_not_detected_for_alternating_agents(self) -> None:
        assert not loop_detected(["a", "b", "a", "b"], _budget(max_loop_iterations=3))

    def test_loop_detected_for_repeated_trailing_agent(self) -> None:
        assert loop_detected(["b", "a", "a", "a"], _budget(max_loop_iterations=3))

    def test_cost_ceiling_reached_by_tokens(self) -> None:
        ledger = CostLedger()
        ledger.record(ModelCallCost("m", 900, 200, 100, False, 10))
        assert cost_ceiling_reached(ledger, _budget(cost_ceiling_tokens=1000))

    def test_cost_ceiling_reached_by_aed(self) -> None:
        ledger = CostLedger()
        ledger.record(ModelCallCost("m", 10, 10, 60_000, False, 10))
        assert cost_ceiling_reached(ledger, _budget(cost_ceiling_micro_aed=50_000))

    def test_cost_ceiling_not_reached_under_both(self) -> None:
        ledger = CostLedger()
        ledger.record(ModelCallCost("m", 10, 10, 100, False, 10))
        assert not cost_ceiling_reached(ledger, _budget())


class TestMergeReplies:
    def test_concatenate_in_order_keeps_every_reply(self) -> None:
        replies = [
            AgentReply("a1", "First statement.", Decimal("0.9")),
            AgentReply("a2", "Second, unrelated statement.", Decimal("0.8")),
        ]
        result = merge_replies(
            replies,
            merge_policy=MergePolicy.CONCATENATE_IN_ORDER,
            conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        )
        assert "First statement." in result.merged_text
        assert "Second, unrelated statement." in result.merged_text
        assert result.discarded == ()

    def test_deduplicate_overlap_drops_the_lower_confidence_duplicate(self) -> None:
        replies = [
            AgentReply("a1", "Your bill is AED 340, due in 14 days.", Decimal("0.60")),
            AgentReply("a2", "Your bill is AED 340, due in 14 days.", Decimal("0.95")),
        ]
        result = merge_replies(
            replies,
            merge_policy=MergePolicy.DEDUPLICATE_OVERLAP,
            conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        )
        assert len(result.discarded) == 1
        assert result.discarded[0].agent_id == "a1"
        assert result.merged_text.count("AED 340") == 1

    def test_deduplicate_overlap_keeps_distinct_statements(self) -> None:
        replies = [
            AgentReply("a1", "Your bill is AED 340.", Decimal("0.9")),
            AgentReply("a2", "The nearest service centre is Al Majaz.", Decimal("0.9")),
        ]
        result = merge_replies(
            replies,
            merge_policy=MergePolicy.DEDUPLICATE_OVERLAP,
            conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        )
        assert result.discarded == ()
        assert "AED 340" in result.merged_text
        assert "Al Majaz" in result.merged_text

    def test_supervisor_rewrite_uses_the_last_reply_and_discards_the_rest(self) -> None:
        replies = [
            AgentReply("worker1", "Bill is AED 340.", Decimal("0.7")),
            AgentReply("worker2", "Centre is Al Majaz.", Decimal("0.7")),
            AgentReply(
                "supervisor", "Your bill is AED 340; nearest centre is Al Majaz.", Decimal("0.95")
            ),
        ]
        result = merge_replies(
            replies,
            merge_policy=MergePolicy.SUPERVISOR_REWRITE,
            conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        )
        assert result.merged_text == replies[-1].text
        assert len(result.discarded) == 2

    def test_merge_is_deterministic_for_the_same_input(self) -> None:
        replies = [
            AgentReply("a1", "Same text here.", Decimal("0.5")),
            AgentReply("a2", "Same text here.", Decimal("0.9")),
        ]
        r1 = merge_replies(
            list(replies),
            merge_policy=MergePolicy.DEDUPLICATE_OVERLAP,
            conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        )
        r2 = merge_replies(
            list(replies),
            merge_policy=MergePolicy.DEDUPLICATE_OVERLAP,
            conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        )
        assert r1.merged_text == r2.merged_text
        assert [d.agent_id for d in r1.discarded] == [d.agent_id for d in r2.discarded]


class TestRoute:
    def test_confidence_is_higher_for_a_matching_domain_vocabulary(self) -> None:
        billing = RoutingCandidate(
            "agt_billing", "avr_1", "Billing", "Handle SEWA bill payment status account"
        )
        faq = RoutingCandidate(
            "agt_faq", "avr_2", "FAQ", "Answer general wayfinding questions about services"
        )
        billing_decision = route(
            "What is my SEWA bill status?",
            billing,
            [],
            execution_mode=ExecutionMode.SEQUENTIAL,
            max_secondary=0,
        )
        faq_decision = route(
            "What is my SEWA bill status?",
            faq,
            [],
            execution_mode=ExecutionMode.SEQUENTIAL,
            max_secondary=0,
        )
        assert billing_decision.confidence > faq_decision.confidence

    def test_sequential_mode_selects_no_secondary_agents(self) -> None:
        primary = RoutingCandidate("agt_1", "avr_1", "Primary", "prompt")
        other = RoutingCandidate("agt_2", "avr_2", "Other", "prompt")
        decision = route(
            "hello", primary, [other], execution_mode=ExecutionMode.SEQUENTIAL, max_secondary=0
        )
        assert decision.secondary == ()

    def test_parallel_mode_selects_up_to_max_secondary(self) -> None:
        primary = RoutingCandidate("agt_1", "avr_1", "Primary", "prompt")
        others = [RoutingCandidate(f"agt_{i}", f"avr_{i}", f"Other{i}", "prompt") for i in range(3)]
        decision = route(
            "hello", primary, others, execution_mode=ExecutionMode.PARALLEL, max_secondary=1
        )
        assert len(decision.secondary) == 1


class TestFilterCandidatesByScope:
    """The real bug fix: `agentSelectionScope` used to have zero effect on which
    candidates `route()` ever saw. `"AllPublished"` is the pre-fix, still-correct
    default behaviour; `"ExplicitList"` is the newly-enforced case."""

    def _candidates(self, *ids: str) -> list[RoutingCandidate]:
        return [RoutingCandidate(agent_id, f"avr_{agent_id}", agent_id, "prompt") for agent_id in ids]

    def test_all_published_passes_every_candidate_through_unchanged(self) -> None:
        candidates = self._candidates("agt_1", "agt_2")
        result = filter_candidates_by_scope(candidates, scope="AllPublished", scope_list=())
        assert result == candidates

    def test_channel_bound_currently_passes_every_candidate_through_unchanged(self) -> None:
        # Documents today's real, deliberately-deferred behaviour — see this
        # function's own doc comment for why. A future real implementation of
        # ChannelBound is forced to touch this test, not silently drift past it.
        candidates = self._candidates("agt_1", "agt_2")
        result = filter_candidates_by_scope(candidates, scope="ChannelBound", scope_list=())
        assert result == candidates

    def test_explicit_list_keeps_only_listed_candidates(self) -> None:
        candidates = self._candidates("agt_1", "agt_2", "agt_3")
        result = filter_candidates_by_scope(
            candidates, scope="ExplicitList", scope_list=("agt_1", "agt_3")
        )
        assert [c.agent_id for c in result] == ["agt_1", "agt_3"]

    def test_explicit_list_with_empty_scope_list_yields_no_candidates(self) -> None:
        candidates = self._candidates("agt_1", "agt_2")
        result = filter_candidates_by_scope(candidates, scope="ExplicitList", scope_list=())
        assert result == []

    def test_explicit_list_silently_drops_an_id_no_longer_published(self) -> None:
        # scope_list names an agent that is no longer in `candidates` at all (it was
        # unpublished after the config was saved) — no error, just absent from the
        # result, since `candidates` is always the live `list_published_agents()` set.
        candidates = self._candidates("agt_1")
        result = filter_candidates_by_scope(
            candidates, scope="ExplicitList", scope_list=("agt_1", "agt_stale")
        )
        assert [c.agent_id for c in result] == ["agt_1"]

    def test_explicit_list_containing_the_primarys_own_id_is_a_no_op(self) -> None:
        # The primary is never in `candidates` (callers already pass
        # `exclude_agent_id=`), so listing it in scope_list changes nothing.
        candidates = self._candidates("agt_2")
        result = filter_candidates_by_scope(
            candidates, scope="ExplicitList", scope_list=("agt_primary", "agt_2")
        )
        assert [c.agent_id for c in result] == ["agt_2"]
