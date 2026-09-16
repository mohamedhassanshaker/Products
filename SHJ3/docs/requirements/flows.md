[← Requirements index](./README.md)

# 5.8 `flows` — flow designer and runtime (B7)

Authored in `shj3-web`, executed in `shj3-ai`. Satisfies brief requirement R3.

> **Not to be confused with the Pipeline Designer** ([`orchestration.md`](./orchestration.md) §5.5.2). A flow is one agent's own internal, scripted dialogue tree (`Message`/`Question`/`Tool call`/`Handover`/`Condition` nodes); a pipeline is a graph of *agent invocations* wired together across a turn. `FlowNode`/`FlowEdge` and `PipelineNode`/`PipelineEdge` are deliberately separate schema families for this reason.

| ID | Requirement | Source | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-FLOW-01 | The system shall author flows on a canvas of connected nodes, where selecting a node opens an inspector for that node's configuration. | B7 canvas | MUST | The seeded flow renders five nodes with their edges. Selecting each node shows the fields listed in B7. Node position and edges persist across a reload. |
| FR-FLOW-02 | The system shall support the node types `Message`, `Question`, `Tool call`, `Handover` and `Condition`. | B7 canvas | MUST | All five types are creatable, configurable and executable at runtime. A flow containing all five executes end to end. |
| FR-FLOW-03 | A `Message` node shall render configured text plus suggestion chips resolved from Quick Actions configuration. | B7; A1 | MUST | Editing a Quick Action changes the chips offered by the node with no flow edit. Chip labels are not stored on the node. |
| FR-FLOW-04 | A `Question` node shall bind its options to a graph entity list rather than to a hardcoded option set. | B7 | MUST | The utility-service question's options derive from the `Provider` entity list; adding a provider entity adds an option without a flow edit. |
| FR-FLOW-05 | A `Tool call` node shall retry once on timeout and, on a second failure, shall fall through to its configured next node rather than terminating the conversation. | B7 | MUST | Force two consecutive timeouts on `get_bill_status`; the runtime performs exactly two attempts and then follows the fall-through edge. The attempt count is on the trace. |
| FR-FLOW-06 | A `Handover` node shall trigger when grounding confidence falls below the configured threshold or when a tool call has failed twice, and shall pass the full transcript to a live agent. | B7; B8 | MUST | Both triggers fire independently. The created ticket carries the whole transcript, not a summary. The two triggers correspond exactly to two of the three escalation reasons in B8 ([`handover.md`](./handover.md) FR-HAND-05). |
| FR-FLOW-07 | The system shall make a free-text escape available at every node of every flow, exiting the flow and returning control to the router. | B7 `[rule]`; A2 step 4 | MUST | From each node of the seeded flow, free text that does not satisfy the node's expectation exits the flow and re-opens routing. No node can trap the user. This is asserted node by node, not once. |
| FR-FLOW-08 | The system shall maintain and expose flow slot state, including the currently awaited slot. | A2 step 3; B7 | MUST | At the account-number step the runtime records `awaiting slot: account_number`, the trace exposes it, and a handover ticket created at that point carries it ([`handover.md`](./handover.md) FR-HAND-17). |
| FR-FLOW-09 | The system shall preserve flow state across an escape so the flow can be resumed at the node where it was left. | A2 step 4 `[rule]` | MUST | Escape at the account-number node, complete an unrelated exchange, then return; the flow resumes awaiting `account_number` with previously filled slots intact. |
| FR-FLOW-10 | The system shall version flows and shall carry a publication status of `Draft` or `Published`. | B3 step 6 | MUST | The two seeded flows show their statuses. Editing a published flow creates a new draft version rather than mutating the live definition. |
| FR-FLOW-11 | The system shall pause a flow for step-up verification before making the tool call, whenever the next action matches a configured step-up rule. | B11 tab 2 `[rule]`; A2 `[rule]` | MUST | For "initiate a payment" the runtime requests verification and OTP and only then calls the payment tool. A test asserting call ordering fails if the tool is called before the assurance level is satisfied. |
| FR-FLOW-12 | A tool call failing twice within a flow shall produce the tool-failure escalation reason on the resulting ticket, carrying the failing tool's identity and both attempt outcomes. | `flows` → `handover`; B7 → B8 | MUST | Force two `get_bill_status` failures: the ticket names the tool, both attempts and their errors. One failure produces no ticket. Three attempts never occur (FR-FLOW-05). *(Cross-module invariant; also listed in [`cross-module.md`](./cross-module.md).)* |

---
[← `knowledge`](./knowledge.md) · [Requirements index](./README.md) · [Next: `handover` →](./handover.md)
