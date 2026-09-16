import json

from shj3_ai.domain.flow_edit_plan import (
    CreateEdgeOperation,
    CreateNodeOperation,
    DeleteNodeOperation,
    SetEscapeNodeOperation,
    UpdateNodeOperation,
    parse_flow_edit_plan,
)

_EXISTING_NODES = frozenset({"node-greeting", "node-question"})
_EXISTING_EDGES = frozenset({"edge-1"})


def test_malformed_json_returns_empty_plan_with_a_warning():
    plan = parse_flow_edit_plan("not json at all", _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.operations == ()
    assert len(plan.warnings) == 1
    assert "not valid JSON" in plan.warnings[0]


def test_a_non_object_json_value_returns_empty_plan_with_a_warning():
    plan = parse_flow_edit_plan("[1, 2, 3]", _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.operations == ()
    assert len(plan.warnings) == 1


def test_an_empty_object_is_a_valid_empty_plan():
    plan = parse_flow_edit_plan("{}", _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.plan_summary == ""
    assert plan.operations == ()
    assert plan.warnings == ()


def test_a_complete_create_node_operation_parses_with_its_placeholder_id():
    raw = json.dumps(
        {
            "planSummary": "Add a farewell message",
            "operations": [
                {
                    "kind": "CreateNode",
                    "localRef": "farewell",
                    "nodeType": "Message",
                    "summary": "Add a friendly goodbye",
                    "title": "Farewell",
                    "messageText": "Thanks for using the service!",
                }
            ],
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.plan_summary == "Add a farewell message"
    assert plan.warnings == ()
    assert len(plan.operations) == 1
    op = plan.operations[0]
    assert isinstance(op, CreateNodeOperation)
    assert op.placeholder_id == "new-1"
    assert op.node_type == "Message"
    assert op.fields.message_text == "Thanks for using the service!"


def test_a_create_node_missing_its_type_required_field_is_dropped_with_a_warning():
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "CreateNode",
                    "localRef": "incomplete",
                    "nodeType": "Message",
                    "summary": "x",
                    "title": "x",
                    # messageText is required for Message — omitted deliberately.
                }
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.operations == ()
    assert len(plan.warnings) == 1
    assert "missing required fields" in plan.warnings[0]


def test_a_create_node_with_an_unrecognised_type_is_dropped_with_a_warning():
    raw = json.dumps(
        {
            "operations": [
                {"kind": "CreateNode", "localRef": "x", "nodeType": "NotARealType", "summary": "x"}
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.operations == ()
    assert "unrecognised node type" in plan.warnings[0]


def test_a_create_edge_can_reference_a_local_ref_defined_earlier_in_the_same_plan():
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "CreateNode",
                    "localRef": "farewell",
                    "nodeType": "Message",
                    "summary": "x",
                    "title": "Farewell",
                    "messageText": "Bye!",
                },
                {
                    "kind": "CreateEdge",
                    "fromNodeId": "node-question",
                    "toNodeId": "farewell",
                    "summary": "Connect to the new farewell",
                },
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.warnings == ()
    assert len(plan.operations) == 2
    create_node, create_edge = plan.operations
    assert isinstance(create_edge, CreateEdgeOperation)
    assert create_edge.from_node_id == "node-question"
    assert create_edge.to_node_id == create_node.placeholder_id == "new-1"


def test_a_create_edge_can_reference_a_local_ref_defined_later_in_the_array():
    """The model has no obligation to order its own operations topologically — an edge
    earlier in the array may legitimately point at a node the array creates later."""
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "CreateEdge",
                    "fromNodeId": "node-question",
                    "toNodeId": "farewell",
                    "summary": "x",
                },
                {
                    "kind": "CreateNode",
                    "localRef": "farewell",
                    "nodeType": "Message",
                    "summary": "x",
                    "title": "Farewell",
                    "messageText": "Bye!",
                },
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.warnings == ()
    assert len(plan.operations) == 2
    create_edge, create_node = plan.operations
    assert create_edge.to_node_id == create_node.placeholder_id


def test_a_create_edge_referencing_an_unknown_node_is_dropped_with_a_warning():
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "CreateEdge",
                    "fromNodeId": "node-question",
                    "toNodeId": "totally-unknown-id",
                    "summary": "x",
                }
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.operations == ()
    assert "unknown node" in plan.warnings[0]


def test_update_node_requires_a_real_existing_node_id_not_a_local_ref():
    raw = json.dumps(
        {
            "operations": [
                {"kind": "UpdateNode", "nodeId": "not-a-real-id", "summary": "x", "title": "New title"}
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.operations == ()
    assert "unknown node" in plan.warnings[0]


def test_update_node_against_a_real_id_parses_as_a_partial_patch():
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "UpdateNode",
                    "nodeId": "node-greeting",
                    "summary": "Make the greeting friendlier",
                    "messageText": "Hi there! How can I help?",
                }
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert len(plan.operations) == 1
    op = plan.operations[0]
    assert isinstance(op, UpdateNodeOperation)
    assert op.node_id == "node-greeting"
    assert op.fields.message_text == "Hi there! How can I help?"
    assert op.fields.title is None  # untouched fields stay None (a genuine partial patch)


def test_delete_node_against_a_real_id():
    raw = json.dumps(
        {"operations": [{"kind": "DeleteNode", "nodeId": "node-question", "summary": "No longer needed"}]}
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert len(plan.operations) == 1
    assert isinstance(plan.operations[0], DeleteNodeOperation)
    assert plan.operations[0].node_id == "node-question"


def test_set_escape_node_can_reference_a_newly_created_condition_node():
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "CreateNode",
                    "localRef": "escape",
                    "nodeType": "Condition",
                    "summary": "x",
                    "title": "Free-text escape",
                    "conditionExpression": "true",
                },
                {"kind": "SetEscapeNode", "nodeId": "escape", "summary": "Designate the new escape node"},
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.warnings == ()
    assert len(plan.operations) == 2
    create_node, set_escape = plan.operations
    assert isinstance(set_escape, SetEscapeNodeOperation)
    assert set_escape.node_id == create_node.placeholder_id


def test_an_unrecognised_operation_kind_is_dropped_with_a_warning_and_does_not_abort_the_rest():
    raw = json.dumps(
        {
            "operations": [
                {"kind": "DoSomethingWeird", "summary": "x"},
                {"kind": "DeleteNode", "nodeId": "node-greeting", "summary": "Still processed"},
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert len(plan.operations) == 1
    assert isinstance(plan.operations[0], DeleteNodeOperation)
    assert len(plan.warnings) == 1
    assert "unrecognised kind" in plan.warnings[0]


def test_a_tool_call_create_node_requires_binding_retry_count_and_on_failure_node():
    raw = json.dumps(
        {
            "operations": [
                {
                    "kind": "CreateNode",
                    "localRef": "fetch",
                    "nodeType": "ToolCall",
                    "summary": "x",
                    "title": "Fetch bill",
                    "toolBindingId": "toolbinding-1",
                    "retryCount": 1,
                    "onFailureNodeId": "node-greeting",
                }
            ]
        }
    )
    plan = parse_flow_edit_plan(raw, _EXISTING_NODES, _EXISTING_EDGES)
    assert plan.warnings == ()
    op = plan.operations[0]
    assert isinstance(op, CreateNodeOperation)
    assert op.fields.tool_binding_id == "toolbinding-1"
    assert op.fields.retry_count == 1
    assert op.fields.on_failure_node_id == "node-greeting"
