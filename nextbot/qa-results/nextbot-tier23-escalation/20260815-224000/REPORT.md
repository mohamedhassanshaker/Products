# QA Report — Plan Phases 14 & 16 (BL-08 Tier-2/3 Approval Engine + Approval Queue UI; BL-09 Escalation Queue/Live Takeover/Routing/Return-to-Bot)

Date: 2026-08-16 · Scope: browser-facing/UI correctness (parallel agent covers backend/security)

## Environment

- Postgres/Redis/ClickHouse: existing ephemeral compose.test.yml stack (already running, already migrated), reused rather than a fresh dev stack.
- apps/web (Admin Console) on http://localhost:3004, apps/gateway (widget ingress) on http://localhost:4002, apps/widget-embed (Vite dev) on http://localhost:5180.
- A real fixture tenant, 3 real Admin Console users (Tenant Admin / Escalation Agent / Designer, for RBAC), a real widget channel, and a real connector exposing two real tools: update_contact_email (Tier 2) and issue_refund (Tier 3).
- A real, standalone OpenAI-compatible HTTP server stood in for the LLM's goal/tool-selection reasoning step (AI_BASE_URL pointed at it) since no paid LLM key was available - the same environment-substitution pattern this project's own architecture (ADR-0006 2.2) and test helpers are built around. Every other hop (gateway HTTP routes, orchestration, tier-engine, approval/escalation services, real Postgres, real MCP tool execution, real Admin Console) is the genuine product code path.
- A real MCP server (self-signed TLS) served the two tools and logged every real call - used as ground truth for Confirm/Approve/Cancel/Reject verification.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| A.2.10 Confirmation Card (Tier-2) | Real "update my email" message renders card with real args; Confirm executes tool; Cancel does not | Pass | MCP log shows exactly one call after Confirm, none after Cancel |
| B.3.6 Approval Queue list | Real Tier-3 refund requests appear with timestamp/tool/wait/conversation link | Partial fail | 03-approval-queue.png; API response shows backendName null, channelType null for every row (Defect D1) |
| B.3.6 Approval detail + Approve | Real transcript/args/goal shown; Approve executes tool; customer gets real result round-trip | Pass | 05-approval-row-detail-panel.png, 06-after-approve.png; MCP log; widget stream shows real DataSummary |
| B.3.6 Reject | Real Tier-3 request, Reject with required note; customer sees decline message with the note | Pass | 09-after-reject.png; widget stream: "Your request was declined: QA test: rejecting this refund request." |
| B.5.1 Escalation Queue | Real "talk to a human" escalation appears with conversation/channel/reason/wait/queue; Take Over claims it | Pass | 10-escalation-queue.png |
| B.5.2 Live Takeover Panel conversation/context | Real transcript, real Context panel fields | Pass (honest empty state) | 11-takeover-panel.png - Recognized goal/Customer/Confidence show em-dash, consistent with the already-disclosed Phase 12/13 trace-data gap, not fake data |
| B.5.2 Tool-call context ("what the AI already tried") | Escalation triggered before any tool call in that conversation | Untested this pass | Snapshot-based aiAttempts needs a tool call before the escalation trigger in the same conversation; not reproduced |
| B.5.2 human message delivery to widget | Agent sends message from Takeover Panel; persisted as HumanAgent sender | Pass (backend) / Fail (live delivery) | Server-side conversation view confirms real HumanAgent message. Widget never showed it live via SSE - Defect D3 |
| B.5.2 Actions bar (Resolve and Close / Transfer / Return to Bot / Create Case) | Visual inspection plus source read | Fail | Only "Resolve and Close" and "Return to Bot" implemented; "Transfer to [queue]" and "Create Case" are entirely absent - Defect D2 |
| B.5.2 Manual Tool Trigger panel | Present (Tool ID + Args JSON + Invoke) | Pass (present), not exercised end-to-end | 11-takeover-panel.png |
| FR-AI-08 AI-drafted reply | "Suggest a reply" - real structured-output call - editable draft, never auto-sent | Pass | 29-suggest-reply-after-wait.png - "Use as draft"/"Discard", loads into editable textarea |
| B.5.3 Escalation Routing Config | Add queue + rule (Reason to Queue); Save; new escalation lands in new queue; fallback still applies to earlier ones | Pass (routing works) / Fail (spec fields) | 27-routing-after-save.png; API confirms new escalation routed to VIP Support, untouched ones stayed on fallback General Support - but see Defect D4 |
| A.2.11 Handoff sequence | Real "talk to a human" in a real browser widget | Pass (visual copy) / Fail (live update) | 14-widget-connecting.png shows exact spec copy plus "Waiting for General Support..." indicator. "Agent joined"/human message never rendered live in the same open tab - Defect D3. Copy wording - Defect D5 |
| A.2.11 Return-to-bot in widget | Not reproduced live this pass (blocked by D3) | Untested | - |
| RBAC (Designer role, no approval/escalation access) | Direct navigation to /approvals and /escalations as Designer | Pass | 23-rbac-designer-approvals-denied.png, 24-rbac-designer-escalations-denied.png - correct AccessDeniedState, nav also hides both links |
| Accessibility (axe-core) - Approval Queue | Automated scan | Fail (2 violations) | axe-approval-queue.json - pre-existing color-contrast (gray.500 text, 4.01:1, known systemic issue) plus page-has-heading-one (moderate, systemic) |
| Accessibility (axe-core) - Live Takeover Panel | Automated scan | Fail (2 violations) | axe-takeover-panel.json - same gray-text contrast issue, plus a new one: a green badge/button at 3.24:1 (white-on-#38a169), below WCAG AA |

## Defects

### D1 - Approval Queue list never shows backend or channel (blocking, spec-required columns)
Expected (B.3.6): "Queue list ... Columns: timestamp, tool name, backend, initiating conversation (link), requested action summary, requesting channel, wait time."
Actual: GET /api/v1/admin/approvals hardcodes backendName: null and channelType: null for every row (apps/web/app/api/v1/admin/approvals/route.ts, lines ~19-20) - a literal stub never wired up, not a query bug. The UI (ApprovalQueue.tsx) correctly renders an em-dash for both (honest empty state), but the data itself is simply never populated, for any real approval.
Repro: provision a Tier-3 tool call, GET /api/v1/admin/approvals as tenant admin - both fields null.
Phase: 14 (Approval Queue UI/API).
Severity: blocking - an admin cannot see which backend/channel an approval belongs to, a named spec requirement.
### D2 - Live Takeover Panel missing 2 of 4 required actions
Expected (B.5.2): "Actions bar: 'Resolve and Close', 'Transfer to [queue]', 'Return to Bot', 'Create Case' (opens tool call form)."
Actual: TakeoverPanel.tsx only implements "Resolve and Close" and "Return to Bot" (confirmed by screenshot and source read - no "Transfer" or "Create Case" button exists anywhere in the file).
Repro: claim any escalation, open /escalations/{id} - Actions column only has 2 buttons.
Phase: 16.
Severity: blocking - two of the four spec'd actions are entirely unimplemented, with no disclosure in the dev decision log for this specific gap (only the poll-vs-SSE and manual-tool-invocation-tier deviations are disclosed there).
### D3 - Human-agent join/message/resolution events don't reach the customer's live widget session
Expected (A.2.11 / B.5.2): "Agent [Name] has joined the conversation" and the agent's own message must appear in the customer's widget in real time.
Actual: In a real, open browser widget tab with a live SSE connection (confirmed connected - the "connecting..." message arrived over that same connection), claiming the escalation and sending a human-agent message from the Admin Console (both confirmed 200, both confirmed persisted server-side - see 19-server-side-conversation-check.png, which shows the full correct transcript including a distinctly-styled HUMANAGENT badge) never updated the widget UI. Screenshots taken 2s and 4s after each admin action are pixel-identical to the pre-action "connecting..." state.
Repro: open the widget in a real browser, send "I want to talk to a human agent", claim + send a message from a second (Admin Console) browser context against the same conversation, observe the widget tab never updates.
Phase: 16 (event emission) and/or a cross-phase seam with the widget's Phase-7/12 SSE message-append path (apps/widget-embed/src/widget/store.ts's handleStreamEvent - code read shows no obvious rejection of System/HumanAgent senders, so the break is more likely in stream delivery/connection, not rendering logic). Flagged for developer investigation to pinpoint exact root cause; note this dev-mode harness's React-StrictMode double-mount created two sessions/EventSources per page load, so recommend the retry verify specifically against a production build to separate a real defect from a test-harness artifact.
Severity: blocking if reproducible in production - the entire human-handoff UX (A.2.11) depends on this.
### D4 - Escalation Routing Config rule editor has no Channel condition
Expected (B.5.3): "Rules table: IF [recognized goal = X] AND [channel = Y] -> route to [queue Z]."
Actual: RoutingConfig.tsx's rule row only exposes Goal and Reason (an escalation-reason enum not named in the spec) as conditions; the underlying data model (conditions.channelTypes) exists but is never rendered/editable anywhere in the file.
Repro: open Escalation Routing Config, "Add Rule" - only Goal/Reason/Queue/Enabled fields exist, no Channel selector.
Phase: 16.
Severity: should-fix - routing itself works correctly for the conditions that do exist (verified live: a new rule genuinely changed which queue a fresh escalation landed in, fallback still correctly applies to non-matching ones), but the spec's actual condition ("channel") isn't usable through this screen at all.

### D6 - New color-contrast violation on the Live Takeover Panel (axe-core)
Expected: WCAG AA 4.5:1 text contrast.
Actual: a green badge/button (white text on #38a169) measures 3.24:1 - below AA. (The other axe finding, gray-500-on-white at 4.01:1, is a pre-existing systemic issue already flagged in prior QA passes across this codebase, not new to this phase.)
Phase: 16.
Severity: should-fix.

### D5 - Agent joined copy doesn't match spec exact wording
Expected (A.2.11): "Agent [Name] has joined the conversation."
Actual: claim-escalation.ts posts the agent's display name followed by "has joined the conversation." directly, with no literal word "Agent" prefixed - e.g. renders as "QA Tenant Admin has joined the conversation." instead of "Agent QA Tenant Admin has joined the conversation." This project has an established precedent (Phase 12/13's BE1) of treating exact required copy as a blocking defect when the spec quotes it verbatim; flagging this explicitly, scored should-fix since it is a single missing word rather than materially different guidance.
Phase: 16.
Severity: should-fix.
### Untested / recommend re-verification next pass
- B.5.2's "tool calls the AI already tried" cards - not exercised with a conversation where a real tool call preceded the escalation trigger (my test conversations escalated on the very first message). Needs a scenario where e.g. a tool-call failure triggers the escalation.
- Manual Tool Trigger panel - present and visible, Invoke button not exercised end-to-end this pass (time-boxed out).
- Transfer-to-queue and Create-Case flows - blocked entirely by D2 (not implemented).
- Live "Returning to AI assistant" widget copy - blocked by D3; only a Resolve action (not Return-to-Bot) was confirmed server-side this pass, which does not itself post that copy.

## Positive findings (explicitly confirmed genuine, not code-read-only)
- Tier-2 Confirm/Cancel: real args-driven card, real Confirm executes exactly once against a real backend, real Cancel executes zero times - verified via independent MCP-server call log, not just HTTP status codes.
- Tier-3 Approve leads to real execution and a real result delivered back to the customer conversation.
- Tier-3 Reject leads to a real decline message including the admin's own note text delivered to the customer.
- Escalation trigger leads to a real queue-visible item; Take Over leads to a Live Takeover Panel showing the real transcript.
- AI-drafted reply (FR-AI-08): genuinely uses generateStructured (TypeBox-validated), never auto-sent, loads into an editable field.
- Escalation routing rules genuinely affect which queue a new escalation lands in; the fallback queue genuinely still applies when no rule matches.
- RBAC: a role without approval_queue/escalations access gets the correct AccessDeniedState and the nav correctly hides both links.
- Context panel's honest empty state (em-dash for Recognized goal/Customer/Confidence) is confirmed not fake/misleading data - it is a real absence, consistent with the already-disclosed Phase 12/13 trace-data gap, represented honestly rather than fabricated.

## Verdict

FAIL - not ready to advance. Two blocking defects (D1: Approval Queue missing spec-required backend/channel columns; D2: Live Takeover Panel missing 2 of 4 required actions) plus one potentially-blocking, unresolved-root-cause defect (D3: live widget delivery of human-handoff events) must be fixed and re-verified before this phase can pass. D4/D5/D6 are should-fix. Recommend dispatching nexus-dev with this report; on retry, specifically re-verify D3 against a production (non-strict-mode) build to separate a real product defect from a dev-harness artifact.
