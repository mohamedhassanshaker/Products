"""Unit tests for the shared `on_error`/`on_deadline` edge resolution
(Phase 10 fix for Phase 9 finding #2, BL-040/041).
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import EndNode
from avatar_agent.orchestration.graph.edges import resolve_on_deadline, resolve_on_error


def make_end_node(*, on_error: dict[str, object], on_deadline: dict[str, object] | None = None) -> EndNode:
    return EndNode.model_validate(
        {
            "id": "n1",
            "type": "end",
            "name": "N1",
            "lane": "foreground",
            "on_error": on_error,
            "on_deadline": on_deadline or {"action": "degrade"},
        }
    )


def test_resolve_on_error_returns_the_goto_target_when_configured() -> None:
    node = make_end_node(on_error={"action": "goto", "target_node_id": "n2"})
    assert resolve_on_error(node) == "n2"


def test_resolve_on_error_returns_none_for_end_turn() -> None:
    node = make_end_node(on_error={"action": "end_turn"})
    assert resolve_on_error(node) is None


def test_resolve_on_error_returns_none_for_degrade() -> None:
    node = make_end_node(on_error={"action": "degrade"})
    assert resolve_on_error(node) is None


def test_resolve_on_error_returns_none_for_a_goto_with_no_target() -> None:
    node = make_end_node(on_error={"action": "goto"})
    assert resolve_on_error(node) is None


def test_resolve_on_error_defensively_rechecks_the_target_exists_when_nodes_by_id_given() -> None:
    node = make_end_node(on_error={"action": "goto", "target_node_id": "ghost"})
    assert resolve_on_error(node, nodes_by_id={"n1": node}) is None
    assert resolve_on_error(node, nodes_by_id={"n1": node, "ghost": node}) == "ghost"


def test_resolve_on_deadline_mirrors_resolve_on_error_for_the_on_deadline_edge() -> None:
    node = make_end_node(on_error={"action": "degrade"}, on_deadline={"action": "goto", "target_node_id": "n3"})
    assert resolve_on_deadline(node) == "n3"
    assert resolve_on_error(node) is None
