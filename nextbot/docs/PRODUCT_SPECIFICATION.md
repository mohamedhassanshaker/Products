# NextBot — Product Specification (PRD/SRS)

**Status:** Draft v1.0 (reconstructed from `docs/NextBot_Screen_Inventory_v3.md` v3.1 and
`docs/nextbot-wireframes/`, no prior PRD existed in the repository)
**Deployment model:** SaaS, Multi-Tenant
**Prepared for:** Nexus pipeline — Architecture, Development, QA phases

---

## 1. Introduction

### 1.1 Purpose

NextBot is a generic, backend-agnostic, omnichannel AI agent orchestration platform.
It lets an organization (a **tenant**) plug in any number of backend systems —
ticketing, CRM, ERP, billing/payments, HRIS, knowledge base, or custom systems — via
the **Model Context Protocol (MCP)**, and exposes those backends' capabilities to an
AI agent that can converse with end users across many channels (web widget, WhatsApp,
Messenger, Instagram, voice/IVR, email, SMS, Slack, Teams). The AI agent
discovers tools from enrolled MCP servers, reasons about which tool(s) to call to
satisfy a user's request, and executes those calls under a tiered approval model that
balances autonomy against risk. Human agents can be brought into any conversation via
escalation/handoff, and external agent systems can interoperate with NextBot via
Agent-to-Agent (A2A) protocol.

This document is the single source of truth for what NextBot must do. It is derived
directly from a detailed, pre-existing screen inventory (84 screens across 5 portals)
that already encodes concrete requirement IDs (e.g. `OC-01`, `MCP-05`, `SEC-02`); this
specification formalizes those into proper functional/non-functional requirements,
adds validation/error/boundary detail the screen inventory only implied, and defines
the data model, MVP scope, and success metrics needed for downstream architecture and
development.

### 1.2 Scope

In scope: the five NextBot portals (Widget, Admin Console, Conversation Designer
Studio, Human Agent Bridge, Developer Portal), the MCP connector/tool/approval-tier
framework, the four-plane agent runtime architecture (Control/Data/Gateway/
Observability planes), multi-channel messaging, human escalation, A2A interoperability,
multi-tenant administration (RBAC/SSO, audit, credential vault, data residency), voice/
IVR, reporting/analytics, and (subject to an open product decision, §7.3) campaign
broadcast messaging and social auto-reply "growth tools."

Out of scope: NextBot does not replace a tenant's backend systems (ticketing, CRM,
etc.) — it orchestrates access to them. It does not provide a full human-agent desktop
(the Human Agent Bridge is deliberately a lightweight context panel, not a helpdesk
replacement). It does not itself host or train foundation models — it routes to
third-party model providers via a Model Gateway.

**2026-08-28 scope extension.** Following a senior-architecture review
(`docs/blueprint/NextBot-Target-Architecture-Blueprint.md`, referred to throughout this
document as "the Blueprint") of the already-shipped platform described above, six new
or restructured subsystems are now in scope and specified in §4.14–§4.19 and
throughout the NFR/data-model sections below: (A) the **MCP Definition Registry** —
promoting the existing connector/tool framework (FR-MCP-01–15) to a governed enrolment
lifecycle with pinned manifests, drift quarantine, and authorable capability groups;
(B) **Knowledge and Graph RAG** — a new ingestion, entity/relation-graph, and
multi-strategy retrieval subsystem extending the existing Knowledge Base (FR-KB-01);
(C) **Skills and the Agent Design Studio** — a new versioned, reusable "skill" artifact
and a third wizard-based agent-authoring mode extending the Agent Platform
Architecture (FR-AGT-*); (D) the **Workflow Designer** — a new versioned orchestration
graph type; (E) **Multi-agent Orchestration** — supervisor/specialist "team" delegation
built on the existing Tool Catalog rather than a parallel mechanism; and (F) **Model
Gateway v2** — replacing today's free-text model-name string with a three-layer
Provider/Model-catalog/Route model. These six modules must preserve, not relax, every
architectural invariant already governing the shipped platform (fail-closed access,
immutable versions, the promotion gate, tool tiering, vaulted-never-returned
credentials, one shared widget artifact, and separate tenant/platform audit trails —
see §9.5 for the full list carried forward as binding constraints on the new FRs).

### 1.3 Glossary

| Term | Definition |
|---|---|
| **Tenant** | A customer organization using NextBot in isolation from other tenants (own channels, connectors, agents, data). |
| **MCP (Model Context Protocol)** | Open protocol by which an AI agent discovers and calls "tools" exposed by a backend system (an MCP server). |
| **MCP Server / Connector** | A registered integration with a specific backend (e.g., a Zendesk connector); exposes one or more **tools**. |
| **Tool** | A single callable capability exposed by an MCP server (e.g., `crm.get_customer_profile`), with an input/output JSON schema. |
| **Approval Tier** | The level of human/customer oversight required before a tool call executes: **Tier 1 Autonomous**, **Tier 2 Customer Confirmation**, **Tier 3 Human Approval**. |
| **Agent Definition** | The versioned, code+config artifact (graph, model, tools, guardrails, eval suite) that defines an AI agent's behavior; stored/versioned in the Agent Definition Registry. |
| **Orchestration Graph** | The execution framework driving an agent's reasoning loop (e.g., LangGraph, Pydantic AI, Google ADK, custom FSM) — pluggable per agent definition. |
| **Capability Group** | An admin-defined named grouping of tools used for organization and tool-selection guidance (not a hard intent classifier). |
| **Playbook** | An optional visual multi-step flow (Dialogue Flow Designer) the agent may follow once it recognizes a matching natural-language condition; supplements, does not replace, autonomous tool selection. |
| **A2A (Agent-to-Agent)** | Protocol allowing NextBot to expose itself as a callable agent to external agents, and to call other agents as a client. |
| **Gateway Agent** | An on-prem lightweight process that tunnels stdio-based MCP servers (behind a customer firewall) to the NextBot control plane over an outbound HTTPS connection. |
| **Escalation / Handoff** | Transfer of an in-progress conversation from the AI agent to a human agent. |
| **Channel** | A specific communication surface — Web Widget, WhatsApp, Messenger, Instagram, Voice/IVR, Email, SMS, Slack, Teams, X. |
| **Environment** | Sandbox, Staging, or Production instance of a connector/agent/channel configuration within a tenant. |
| **HITL (Human-in-the-Loop)** | A runtime interrupt/resume mechanism pausing agent execution pending human approval. |
| **Manifest** | The hashed, pinned snapshot of the tools, resources, and prompts an MCP server exposed at the moment it was approved (Blueprint §6). |
| **Drift / Drift Quarantine** | A detected divergence between an MCP server's live manifest and its pinned manifest; a drifted item is quarantined (disabled, Tier 3) until a human reviews it (Blueprint §6.4). |
| **Knowledge Collection** | A tenant-scoped, versioned knowledge index (vector + graph) built from ingested sources, pinned to a specific embedding model generation (Blueprint §7). |
| **Graph RAG** | Retrieval that walks entity/relation edges extracted from ingested content, in addition to or instead of plain vector similarity (Blueprint §7). |
| **Community** | A cluster of related entities in a knowledge graph, summarized so broad thematic questions can be answered without reading every chunk (Blueprint §7, Appendix B). |
| **Groundedness** | The proportion of a generated answer supported by retrieved evidence; used both as an eval metric and, via `refuseWhenUngrounded`, as a runtime refusal condition (Blueprint §7.5). |
| **Skill** | A named, versioned bundle of one agent capability — trigger, tool/knowledge scope, instructions, success criteria, escalation conditions, and eval cases — composed into an agent version (Blueprint §8). |
| **Agent Design Studio** | A wizard-based, third authoring mode (alongside Text and Design mode) that composes skills into the same immutable agent-version YAML (Blueprint §8.2). |
| **Workflow** | A versioned orchestration graph (trigger/agent/skill/tool-call/router/human-task/parallel-join/loop/sub-workflow/wait/end nodes) promoted through the existing promotion gate (Blueprint §9). |
| **Team** | A supervisor agent plus scoped specialist member agents, registered as Tool Catalog entries, with delegation limits and a declared failure mode (Blueprint §10). |
| **Delegation Chain** | The ordered record of which agent invoked which specialist, used for audit attribution and Approval Queue context in multi-agent orchestration (Blueprint §10.4/§10.5). |
| **Model Provider** | A connection to a model-serving endpoint (Anthropic, OpenAI, Azure OpenAI, Google Vertex, Bedrock, OpenRouter, openai-compatible, Ollama, etc.) — Layer 1 of Model Gateway v2 (Blueprint §11.2). |
| **Model Catalog Entry** | A specific model's metadata (context window, price, capabilities, deprecation date) belonging to a provider — Layer 2 of Model Gateway v2, replacing the free-text model-name string (Blueprint §11.2/§11.4). |
| **Model Route** | A named, versioned logical endpoint agents reference, backed by an ordered provider+model fallback chain with declared failover/residency policy — Layer 3 of Model Gateway v2 (Blueprint §11.2/§11.5). |

---

## 2. Vision & Business Goals

**Vision:** Any organization should be able to give an AI agent safe, governed access
to its existing backend systems — without months of custom bot-building — and let that
agent serve customers or employees across every channel they already use.

**Business goals:**
1. Reduce cost-to-serve by resolving a majority of routine customer/employee requests
   without human involvement, while keeping a safe, auditable escalation path for
   everything else.
2. Make backend integration a configuration exercise (register an MCP server, enroll
   tools, set approval tiers) rather than a custom engineering project per backend.
3. Provide enterprise-grade trust controls (approval tiers, PII masking, audit log,
   credential vaulting, data residency) so regulated industries (finance, government,
   healthcare, telecom) can adopt AI agents with confidence.
4. Support true omnichannel parity — the same agent, tools, and guardrails work
   identically whether the customer arrives via web widget, WhatsApp, voice, or email.
5. Let the underlying AI orchestration technology (model vendor, orchestration
   framework) evolve without customers/tenants needing to re-platform, by keeping model
   routing and orchestration graph choice pluggable per agent definition.

---

## 3. Personas & Roles

| Persona | Description | Primary Portal(s) |
|---|---|---|
| **End Customer / Employee** | The person conversing with the AI agent to get something done (check an order, submit a request, ask a question). No account needed for most flows. | A — Widget (and channel equivalents) |
| **Platform Admin (Tenant Admin)** | Configures channels, connectors, tools, approval policies, users/roles, security, and data residency for their tenant. Typically an IT/ops lead. | B — Admin Console (all sections) |
| **Backend System Owner** | Owns a specific backend (e.g., "the CRM team") and configures/maintains its connector and tool permissions. Narrower scope than Platform Admin. | B.3, B.3A |
| **Conversation / Bot Designer** | Configures capability catalogs, dialogue playbooks, guardrails, and knowledge base content. Non-engineer, business-facing. | C — Conversation Designer Studio |
| **Platform Engineer / Senior Admin** | Manages agent definitions, deployments/canaries, evals, model gateway, and runtime observability — the underlying agent architecture. | B.15 — Agent Platform Architecture Console |
| **Human Escalation Agent** | Picks up conversations escalated from the AI, resolves them using NextBot context plus their existing backend agent console. | D — Human Agent Bridge |
| **Developer / Integrator** | Builds new MCP connectors, integrates via A2A, tests tool/channel behavior. | E — Developer Portal |
| **NextBot Platform Operator** (cross-tenant, internal) | Operates the multi-tenant SaaS platform itself: tenant provisioning, cross-tenant capacity/quota, incident response. Not a tenant-facing role. | Internal ops tooling (not detailed as a portal here; see NFR-11) |

---

## 4. Functional Requirements

Requirement IDs are preserved from the screen inventory's existing scheme and
formalized here. Each requirement states target behavior, inputs, validation/error
behavior, concurrency/idempotency notes where relevant, and boundary cases.

### 4.1 Omnichannel & Channel Management (`OC-`)

**FR-OC-01 — Embeddable Web Widget.** The widget must be embeddable in any website via
a `<script>` tag and in mobile apps via WebView/SDK, rendering a launcher button that
expands into a conversation window.
- Required config: `tenantId`, `channelId`. Optional: `position`, `language`,
  `direction`, `theme.*`, `quickActions[]`, `menu.*`, `proactiveNudge.*` (see embed
  schema, §6.7 host config data).
- Validation: missing `tenantId` → widget fails to initialize and logs
  `NEXTBOT_INIT_ERROR: tenantId is required` to the browser console; no UI is rendered
  (fails closed, never shows a broken widget to the end user).
- Unknown/deactivated `tenantId` or `channelId` → widget renders the launcher in a
  disabled state with tooltip "Chat is temporarily unavailable."
- Boundary: on a host page with no network connectivity, the launcher still renders
  (from cached static assets) but the input area shows "You're offline — messages will
  send once you're back online" and queues outbound messages client-side (max 20
  queued messages; beyond that, oldest are dropped with a console warning).

**FR-OC-02 — Channel Registration & Overview.** Admin can view all configured channels
(Web Widget, WhatsApp, Messenger, Instagram, Voice, Email, SMS, Slack, Teams) in one
list with type, status, and 24h message volume. *(X/Twitter was evaluated and
dropped from scope by user decision on 2026-08-15 — no further requirements existed
for it in the source material, and it carries a paid commercial API tier plus
restrictive DM limits not justified without a concrete demand signal.)*
- A channel has exactly one of three statuses: `Active`, `Inactive`, `Error`.
- Disabling a channel with active conversations does not terminate them but blocks new
  inbound sessions; attempting to disable is confirmed with a modal stating the count
  of active conversations that will continue to completion.

**FR-OC-03 — Channel Setup Wizard.** Adding a channel launches a type-specific wizard
collecting the connection details that type requires (e.g., Meta OAuth for WhatsApp,
phone number provisioning for Voice).
- Validation is channel-type-specific (see FR-META-* and FR-OC-05 for voice); a wizard
  cannot be completed (no "Activate" action available) until all required fields for
  that channel type pass validation.

**FR-OC-04 — Channel Routing Rules.** Admin can define ordered rules of the form
`IF channel = X AND recognized_task = Y AND <condition> THEN allow | deny | redirect_to_queue`.
- Rules evaluate top-to-bottom; first match wins. If no rule matches, a tenant-level
  default action applies (default: `allow`).
- A "Test a scenario" tool evaluates a hypothetical channel + utterance against the
  current rule set and shows which rule fires, without needing a live conversation.
- Boundary: an empty rule set is valid (falls through to the default action for every
  message) — this is the zero-state, not an error.

**FR-OC-05 — Voice / IVR Channel.** Admin configures phone numbers, STT/TTS engine and
voice, an optional pre-AI IVR menu tree, and fallback behavior (queue to human,
voicemail, callback request) for when the voice channel fails.
- A phone number must be validated as E.164 format at entry time; invalid format
  produces inline error "Enter a valid phone number in international format
  (e.g., +15551234567)."
- If STT confidence for an utterance falls below a configurable threshold (default
  0.6), the system re-prompts once ("Sorry, I didn't catch that — could you repeat?")
  before falling back to the configured fallback behavior.

**FR-OC-06 — Channel-Specific Rendering Fallback.** Message types authored generically
(quick replies, lists, forms) must degrade gracefully on channels that cannot render
rich UI (e.g., voice, plain SMS): forms fall back to sequential one-field-at-a-time
prompts; quick replies fall back to numbered text options.
- This fallback must be automatic based on channel capability metadata — content is
  never authored twice per channel.

**FR-OC-07 — Language Selection & i18n.** The widget supports a configurable list of
languages (up to 40+, see NFR-8), auto-detects browser/customer language where
possible, and persists the user's selection in local storage/session for the duration
of that session.
- If auto-detection is ambiguous or unsupported, the widget defaults to the tenant's
  configured default language and does not block interaction while asking.
- RTL languages (e.g., Arabic) auto-activate RTL layout across the entire widget,
  including message bubbles, forms, and quick-reply chip ordering.

### 4.2 AI Agent Orchestration & Conversation (`AI-`)

**FR-AI-01 — Capability & Parameter Model.** The Conversation Designer defines
capability groups, tool descriptions, and parameter-validation hints (not rigid
declared intents); the agent extracts goals and parameters from free text at runtime.
- Parameter validation hints (regex/enum/date/number/phone/email/national-ID pattern)
  are applied to *extracted* values before a tool payload is constructed; a value
  failing validation produces a targeted re-prompt naming the specific field and
  expected format (e.g., "That doesn't look like a valid email — could you share it
  again?"), not a generic "invalid input" message.

**FR-AI-02 — Autonomous Tool Selection.** The agent selects which enrolled, visible
tool(s) to call based on tool descriptions, schemas, capability-group priority
weights, and any applicable selection guidance — without requiring an admin to
pre-declare every intent-to-tool mapping.
- If two or more tools could equally satisfy a recognized goal, the tool with the
  higher agent-priority weight (1–100) is preferred; ties are broken by most-recently
  successful tool for that goal in the tenant's history, then alphabetically as a
  final deterministic tiebreak (for testability).

**FR-AI-03 — Multi-Step / Multi-Backend Planning.** The agent can execute an explicit
admin-authored multi-tool workflow (Tool Composition, §4.3) or improvise a multi-step
plan across multiple backends when no explicit workflow matches.
- Each step's output can be mapped to the next step's input with type checking against
  the destination tool's input schema; a type mismatch halts the workflow at that step
  and surfaces the configured fallback (retry / skip / escalate / call alternative
  tool) rather than silently coercing types.
- Idempotency: any workflow step classified as a write tool must not be automatically
  retried by the orchestration core without either (a) tool-level idempotency-key
  support or (b) explicit admin opt-in for that tool; default behavior on a failed
  write-step is to halt and follow the configured fallback, never blind-retry.

**FR-AI-04 — Rich Conversational Message Types.** The agent can render/consume: text,
quick-reply chips, interactive lists/pickers, external link/action cards, document
download cards, generic data-summary cards, data-table/list cards, multi-field forms,
OTP/identity cards, confirmation/action cards, ticket-created/status cards, and
file-upload attachments — each with the specific empty/error states defined in the
screen inventory (e.g., data-table card empty state renders "No results found.").

**FR-AI-05 — Fallback & Error Messaging.** The agent must produce one of three
specific fallback messages depending on failure class: backend timeout ("I'm having
trouble reaching the system right now. Please try again in a moment, or I can connect
you to an agent."), goal-not-understood (re-prompt + quick-reply chip options), and
tool-call failure ("Something went wrong while processing your request. I've logged
this — would you like to try again or speak with an agent?").
- Every fallback of the tool-call-failure class must log a correlatable event to the
  Audit Log / Trace Viewer with the tool name, input args (PII-masked per FR-SEC-04),
  and error detail, so "I've logged this" is a factual claim, not a placebo message.

**FR-AI-06 — Conversation Persistence & Listing.** Every conversation (across all
channels) is persisted with channel, customer identifier, status (Active / Resolved /
Escalated), recognized goal, duration, and resolution type (AI / Human / Abandoned),
and is listable/filterable/exportable by admins.
- A conversation with no messages beyond channel-open (customer opened widget, sent
  nothing) after a configurable idle timeout (default 30 min) is marked `Abandoned`,
  not `Active` indefinitely.

**FR-AI-07 — Confidence Scoring.** Each AI message/response carries a confidence score
surfaced in the trace viewer (green >0.85, amber 0.60–0.85, red <0.60); confidence
below the amber threshold on a given turn is one of the guardrail-configurable
conditions that can trigger mandatory human handoff.

**FR-AI-08 — AI-Assisted Human Agent Drafting.** During a live human takeover, the
system offers an AI-drafted reply as an editable suggestion; the human agent may
accept as-is, edit, or discard it. Draft suggestions are never auto-sent without
explicit human action.

**FR-AI-09 — Self-Learning / Gap Suggestion Loop.** The system mines unhandled or
low-confidence-resolved goals from conversation history and surfaces suggested
improvements (new tool needed, better tool description) to the Conversation Designer
with explicit accept/dismiss actions — suggestions never auto-apply.

**FR-AI-10 / FR-AI-11 — Guardrails.** Admins define guardrail rules (spam filter,
capability gate, amount threshold, PII block, sensitive-topic flag) as
condition→action rules (e.g., "IF input contains credit card number → mask and warn",
"IF recognized_task = X AND amount > threshold → escalate to human"). Guardrail rules
are evaluated before a matching tool call executes, not only at the end of a
conversation turn, so an over-threshold write action is blocked pre-execution, not
undone after the fact.

**FR-AI-12 — Cost Attribution.** Every AI-generated response and every tool call is
attributed to a token/cost figure, rolled up by conversation, goal/capability, tool,
backend, and channel, feeding the AI Cost Report (FR-RP-07).

### 4.3 MCP Backend Connector & Agent Tool Management (`MCP-`) — Core Differentiator

**FR-MCP-01 — Connector Registration.** Admin registers an MCP server as a connector:
name, description, backend type (Ticketing/CRM/ERP/Billing-Payments/HRIS/Knowledge
Base/Custom), environment (Sandbox/Production), transport (Streamable HTTP or
stdio-via-Gateway-Agent), and auth method (OAuth2/API Key/Bearer Token/Custom Header).
- Duplicate connector names within the same tenant + environment are rejected with
  "A connector named '<name>' already exists in this environment."
- A connector's status is exactly one of `Connected`, `Degraded` (health check
  succeeding but above latency/error threshold), or `Offline` (health check failing or
  credential expired) — computed from the health-check subsystem (FR-MCP-08), not
  manually set.

**FR-MCP-02 — Tool Discovery.** "Discover Tools" invokes the MCP server's `list_tools`
and returns tool name, description, input/output JSON schema, and an
auto-classification of Read vs. Write (based on schema/verb heuristics, overridable by
the admin).
- If `list_tools` fails (timeout, auth failure, malformed response), the wizard halts
  at that step with the specific transport-level error surfaced verbatim (e.g., "Tool
  discovery failed: 401 Unauthorized from MCP server") rather than a generic failure.
- Re-discovery on an already-enrolled connector diffs the new tool list against the
  prior one and flags added/removed tools and schema changes (including breaking
  changes) before the admin re-confirms.

**FR-MCP-03 — Tool Catalog (Central Registry).** All discovered-and-enabled tools
across all connectors are listed in one catalog: name, connector, description, type,
approval tier, 7-day call count, avg latency, error rate — filterable by connector,
type, approval tier, and status.
- A tool that has never been called shows "—" (not "0%") for success rate/latency to
  distinguish "no data yet" from "0% success."

**FR-MCP-04 — Tool Permission Scope Matrix.** Per tool, admins define Allow/Deny/
Require-Approval across dimensions: channel, role, recognized task, customer segment,
via both a matrix UI and a rule-builder ("WHEN channel = X AND task = Y AND <cond> →
action"). Defaults inherit from backend-type-level policy (e.g., all Billing write
tools default to Tier 2/"Require Customer Confirmation"), overridable per tool.
- A tool with no explicit rule and no inherited backend-type default is **denied by
  default** (fail-closed) — the agent will never call an unpermissioned tool.

**FR-MCP-05 — Three-Tier Approval Model.** Every write tool call is executed under
exactly one of:
  - **Tier 1 (Autonomous):** executes immediately, logged.
  - **Tier 2 (Customer Confirmation):** the customer must explicitly confirm
    (Confirmation/Action Card, FR-AI-04) before execution; a "Cancel" response aborts
    the call and no backend mutation occurs.
  - **Tier 3 (Human Approval):** the call is queued to the Approval Queue and does not
    execute until a human admin approves; the conversation is paused on that
    action (HITL interrupt) and can be resumed on Approve, aborted with a
    tool-generated rejection message relayed to the customer on Reject, or held open
    on "Request More Info" (which injects a follow-up question back into the
    conversation without discarding the pending call).
- Concurrency: a pending Tier 3 approval on a conversation blocks only that specific
  tool call, not the entire conversation — the customer can continue chatting about
  other topics while the approval is pending.
- Idempotency: every Tier 2/3 call carries a server-generated idempotency key; a
  duplicate approval action (e.g., double-click "Approve") executes the underlying
  tool call at most once.

**FR-MCP-06 — Full Auditability.** Every tool call (any tier) is logged with actor
(AI/human), timestamp, tool, input args, output, latency, status, and is linked to its
originating conversation and (if applicable) A2A task and Audit Log entry.

**FR-MCP-07 — Structured Result Rendering.** Tool call outputs render as one of the
generic card types (data summary, data table, document/download, external link) per
FR-AI-04, driven by output schema shape, not per-connector custom UI code.

**FR-MCP-08 — Health Monitoring, Alerting, Circuit Breaker.** Each connector/tool is
health-checked on a configurable interval; alert thresholds (latency > X ms, error
rate > Y%, offline > Z minutes) route to email/Slack/in-app notification; a tool or
server that repeatedly fails trips a circuit breaker (auto-disabled) requiring an
explicit "Reset" after investigation — the agent will not call a tripped tool even if
otherwise permissioned.

**FR-MCP-09 — Sandbox Testing.** Every connector/tool has a sandbox test panel (pick
tool → sample args from schema → execute → view raw request/response) plus an
end-to-end conversation simulator (type message → goal recognition → tool selection →
payload → response) usable before production activation.

**FR-MCP-10 / FR-MCP-11 — Pre-built Templates & Custom Servers.** Admins may enroll
via a pre-built connector template (Zendesk, Salesforce, SAP, Jira SM, Freshdesk,
HubSpot, NetSuite, ServiceNow, Stripe, Twilio, etc.) with guided/pre-populated fields,
or a fully custom MCP server (manual entry, JSON schema validated).

**FR-MCP-12 — Gateway Agent (On-Prem Tunneling).** For stdio-based/on-prem MCP
servers, an admin downloads/registers a Gateway Agent that tunnels over outbound
HTTPS; connectors reached this way are labeled "via Gateway Agent" and show tunnel
status/last heartbeat.
- If the Gateway Agent's heartbeat is missed for a configurable window (default 5 min),
  all connectors routed through it flip to `Offline` and any pending tool calls
  through that path fail with "Gateway Agent unreachable — check on-prem connectivity."

**FR-MCP-13 — Agent Tool Registry (Unified Agent-Facing View).** A single view
aggregates every enabled tool from every connector as the AI agent actually sees it:
agent-visibility toggle (per tool — OFF means "exists in catalog, never selectable by
the agent"), priority weight, capability-group assignment, and health summary.
- Toggling visibility OFF on a tool mid-conversation does not abort a tool call
  already in flight for that turn, but the tool will not be selected on any
  subsequent turn.

**FR-MCP-14 — Tool Composition / Multi-Step Workflows.** Admins can define explicit
tool chains (steps, branching on tool output, cross-backend field mapping, per-step
fallback behavior: retry/skip/escalate/alternative-tool) as an alternative to relying
solely on autonomous multi-step planning (FR-AI-03), testable via simulation before
activation.

**FR-MCP-15 — Tool Schema Inspector.** Any tool's full input/output JSON Schema is
browsable as an interactive tree (types, required/optional, constraints), with an
auto-generated "Try it" form, version-diff on schema change, and a preview of exactly
the description+schema text the AI agent uses for tool-selection reasoning (with an
inline description-override editor).

#### MCP Definition Registry (Module A — Blueprint §6) — extends FR-MCP-01/02/03

The connector/tool framework above (FR-MCP-01–15) remains exactly as specified; the
following requirements promote it from a connection manager into a governed enrolment
lifecycle. They must integrate with the existing Tool Catalog, permission scope
matrix, and health-monitoring screens (FR-MCP-03/04/08) rather than duplicate them.

**FR-MCP-16 — Nine-Step Enrolment Wizard.** Registering an MCP server (in addition to
the fields in FR-MCP-01) walks: (1) Identify — name, description, owner, backend type,
business criticality; (2) Transport and endpoint — a separate endpoint per environment
under one logical server, rather than a separate connector row per environment
(Blueprint §6.1 "no environment binding" gap); (3) Authentication — credential written
to the existing vault (FR-SEC-02), with sandbox and production credentials captured
and stored separately so sandbox/version testing never reaches live systems; (4)
Discovery handshake — connect, enumerate tools **and resources and prompts** (not
tools only), capture JSON schemas, and hash the full response into a pinned manifest;
(5) Classification — read/write and approval tier per discovered item, pre-filled by
the existing heuristic (FR-MCP-02) and confirmed by a human; (6) Grouping — assign
items to capability groups (FR-MCP-17); (7) Runtime policy — timeout, retry,
circuit-breaker threshold, per-tool rate limit, cost-attribution tag, egress
allowlist; (8) Dry run — invoke one read-only tool against the sandbox credential and
show the raw result before anything is enrolled; (9) Enrol — writes the definition and
manifest hash to the Audit Log (FR-ADM-03).
- Validation: any item left unclassified at step 5 defaults to **Tier 3 and disabled**
  (fail-closed) — the wizard never defaults an unclassified item to autonomous
  execution.
- Boundary: a server exposing zero tools/resources/prompts at discovery is a valid
  (if degenerate) enrolment outcome — the wizard completes with an empty manifest and
  a "No tools discovered — this server currently has nothing to enrol" notice, not an
  error.

**FR-MCP-17 — Capability Group Management Screen.** Admins can create, edit, rename,
and delete capability groups (the same `CapabilityGroup` entity already in the data
model, §6.1) and assign/reassign tools to them, from a dedicated `/mcp/capability-groups`
screen — closing the gap where Design mode's capability-group picker (FR-AI-01) has no
authoring surface anywhere (Blueprint gap G-06).
- Deleting a group that still has tools assigned requires confirmation and reassigns
  those tools to "Ungrouped" rather than leaving a dangling reference or silently
  deleting the tools themselves.

**FR-MCP-18 — Manifest Pinning and Drift Quarantine.** Every enrolled MCP server
records an immutable, versioned `mcp_server_version` with a `manifest_hash` computed
from its discovered tools/resources/prompts at approval time (Blueprint §6.4).
  - A background reconciler re-fetches each server's live manifest on a configurable
    schedule and compares it to the pinned hash.
  - **A newly appeared tool/resource/prompt enrols as disabled and Tier 3** until a
    human reviews it via the drift review screen (`/mcp/servers/[id]/drift`) — it is
    never auto-enabled.
  - **A changed input schema on an already-approved tool is treated as an entirely new
    item requiring review, never as an in-place update** — this is a deliberate
    fail-closed design choice (Blueprint §6.4: "that is exactly the vector by which a
    compromised or updated server escalates its own privileges"), not merely a
    notification.
  - Every agent version records the `server_version_id` it was validated/sandbox-tested
    against; drift on that pinned version surfaces as a warning badge on the agent
    version detail page, not as a change in production behavior — the agent keeps
    calling the pinned-shape tool until a human re-approves the new manifest.
  - Idempotency: repeated reconciler runs against an unchanged manifest produce no new
    `mcp_drift_event` rows (hash-compared, not re-alerted every cycle).
  - Boundary: a server that becomes completely unreachable during a scheduled
    reconciliation is **not** treated as drift — it is a health-status transition
    (FR-MCP-01/08, → `Offline`), logged separately from a drift event.

**FR-MCP-19 — Environment-Bound Server Definitions.** One logical MCP server definition
supports Sandbox/Staging/Production endpoint bindings (each with its own credential and
reachability status) under a single server identity, superseding the current pattern of
one connector row per environment (Blueprint §6.1).
- Validation: at least one environment binding is required to enrol; a server with zero
  bindings cannot leave Draft state.

**FR-MCP-20 — Resources and Prompts as First-Class Manifest Items.** Discovery (FR-MCP-16
step 4) captures MCP resources and prompts alongside tools, each recorded in the
`mcp_manifest_item` table with its own `kind`. Resources are additionally offered as
ingestion-candidate sources to the Knowledge subsystem (FR-KB-05) rather than being
discarded, as they are on the current platform.

**FR-MCP-21 — Server Definition Versioning for Reproducibility.** MCP server
definitions are versioned and immutable per version (new manifest hash → new
`mcp_server_version` row); an agent, skill, or workflow that pins
`server@definitionVersion` remains reproducible even after the live server drifts,
consistent with the "immutable versions" invariant (Blueprint §3.2).

### 4.4 Ticketing / Case Management (`TCK-`) — via connected backends

**FR-TCK-01 — Case/Ticket Creation.** When a connected ticketing backend's
create-case tool succeeds, the agent renders a Case Created confirmation with a
copyable tracking number, type, priority, and created date.
- If the create-case tool call fails, the agent does not fabricate a tracking number;
  it surfaces the tool-call-failure fallback (FR-AI-05).

**FR-TCK-02 — Case/Ticket Status Lookup.** Given a tracking number, the agent calls
the backend's status tool and renders status (Open/In Progress/Resolved/Closed),
assigned team, and last update.
- An unrecognized tracking number produces a specific message ("I couldn't find a case
  with that tracking number — please double-check and try again") distinct from a
  generic tool failure.

**FR-TCK-06 — File Attachment on Cases.** Customers can attach files (jpg, png, pdf,
doc, xlsx, subject to the connected backend's size/type limits) to a case-creation
flow; unsupported file type/size is rejected client-side with the specific limit
stated (e.g., "File exceeds the 10 MB limit for this backend.").

**FR-TCK-07 — SLA Compliance Reporting (passthrough).** Where the connected ticketing
backend exposes SLA data, NextBot surfaces breach rate, avg first-response and
resolution time by priority as a passthrough report — NextBot does not define or
enforce SLAs itself.

### 4.5 Human Escalation (`ESC-`)

**FR-ESC-01 — Escalation Triggering.** A conversation escalates to the human queue on
any of: low AI confidence (below configured threshold), tool-call failure exhausting
retries, explicit customer request ("talk to a human"), or a guardrail-flagged
sensitive topic.
- Every escalation records its specific trigger reason (one of the four above) —
  this reason is a required, non-null field on the escalation record, used for
  routing (FR-ESC-03) and reporting.

**FR-ESC-02 — Live Agent Takeover.** A human agent can take over an escalated
conversation, seeing full AI-attempted context (recognized goal, tool calls already
made with inputs/outputs, confidence score), send messages directly, optionally use
AI-drafted suggestions (FR-AI-08), and manually trigger permissioned MCP tools from
the same panel.

**FR-ESC-03 — Escalation Routing.** Rules of the form `IF recognized_goal = X AND
channel = Y → route to queue Z`, with an explicit required fallback/default queue
when no rule matches (routing must never leave an escalation unassigned to any
queue).

**FR-ESC-04 — Return to Bot.** A human agent can explicitly return a conversation to
the AI agent after resolving the immediate issue; the customer sees a system message
("Your issue has been resolved. Returning to AI assistant.") and the AI resumes with
the conversation's accumulated context intact (not reset to a fresh session).

### 4.6 Agent-to-Agent Interop (`A2A-`)

**FR-A2A-01 — Agent Card Publishing.** NextBot publishes a machine-readable "agent
card" describing its exposed capabilities, auth method, and supported task types, to a
self-hosted well-known URI (always on) and optionally to a private registry or public
marketplace, gated by trust configuration.

**FR-A2A-04 / FR-A2A-06 — Task Lifecycle.** Inbound and outbound A2A tasks move
through a defined status lifecycle: `submitted → working → input-required →
completed | failed`, each linked to a NextBot conversation (if any) and any MCP tool
calls it triggered.
- A task stuck in `input-required` past a configurable timeout (default 24h) is
  auto-marked `failed` with reason "Timed out awaiting input" rather than remaining
  indefinitely open.

**FR-A2A-05 — Trusted Agent Registry.** Admin maintains a list of trusted external
agents (identity URI, auth method, trust level Full/Restricted), with add/edit-
permissions/revoke/rotate actions.
- Revoking trust immediately invalidates that agent's active credentials; any A2A
  task already `working` at time of revocation is allowed to complete but no new task
  from that agent is accepted (fail-closed on new work, not abrupt mid-task failure).

### 4.7 Multi-Tenant Administration (`ADM-`)

**FR-ADM-01 — Global Navigation & Tenant Context.** All Admin Console screens operate
within a single tenant context (tenant name/logo, environment badge) with no
cross-tenant visibility for tenant-scoped roles.

**FR-ADM-02 — RBAC.** Roles are defined with a per-module (channel config, connector
config, tool permissions, agent tool config, approval queue, reporting, A2A config)
Read/Write/None permission matrix; SSO group mapping can auto-assign roles.
- A user with no role assigned cannot log in to the Admin Console (fails closed);
  attempting to authenticate with zero assigned roles produces "Your account has no
  assigned role — contact your administrator" rather than a generic auth error.

**FR-ADM-03 — Audit Log.** Every config change, tool call, login, escalation, A2A
task, and approval decision is logged with actor, action type, target, PII-masked
detail payload, and outcome (Success/Failure/Pending); filterable, full-text
searchable, exportable as CSV/JSON.
- Audit log entries are immutable (append-only) — no UI path exists to edit or delete
  an audit record.

**FR-ADM-04 — Approval Queue Access.** Access to the Approval Queue (FR-MCP-05 Tier 3)
is itself a permissioned module in RBAC; a user without Approval Queue access cannot
approve/reject pending tool calls even if they can view the connector that owns the
tool.

**FR-ADM-05 — Environment Management.** Each connector/channel/agent-deployment
exists in exactly one of Sandbox/Staging/Production per tenant; promotion between
environments is an explicit, confirmed action, never implicit on save.

**FR-ADM-06 — Data Residency & Retention.** Admin selects a storage region (e.g., UAE,
EU, US — configurable list, see NFR-6) and sets retention periods (days) independently
for conversation transcripts, tool-call payloads, tool-call metadata, and PII, with
auto-purge enforcement; a GDPR-style "Process Data Subject Request" tool supports
search/view/export/delete by customer identifier across all of a tenant's data.
- A retention period of 0 or unset is invalid and rejected at save time with "Set a
  retention period greater than 0 days, or choose 'Indefinite' explicitly" — the
  system never silently interprets "blank" as "forever" or "immediately delete."

**FR-ADM-07 — Platform Branding & White-Label Theming.** Each tenant configures a
single, platform-wide brand profile — primary color, secondary/accent color, logo
(light/dark variants), favicon, and font family — from one Admin Console screen
(Settings → Branding), and that profile is the single source of truth propagated
everywhere the tenant's identity appears, not configured redundantly per surface:
- **Widget** (Portal A): the brand profile supplies the *default* values for the
  embed config's `theme.*` fields (§6.7 / FR-OC-01); a host page may still override
  colors/logo per-embed for a multi-brand tenant, but absent an override the widget
  inherits the tenant brand profile automatically (no separate configuration step).
- **Admin Console chrome** (Portals B/C/D): for tenants with white-labeling enabled
  (a plan-gated toggle, since default admin chrome carries NextBot's own branding),
  the same primary/accent colors and logo replace NextBot's default admin theme in
  the top bar and login screen (B.1.1).
- **Developer Portal** (Portal E) and transactional emails (e.g., password reset,
  approval-queue notification digests) also inherit logo + primary color when
  white-labeling is enabled.
- Validation: primary/secondary colors are hex values passed through a contrast
  checker against both light and dark surface backgrounds; a color failing WCAG 2.2
  AA contrast (NFR-7) for its intended use (e.g., button text on primary-color
  background) is flagged inline with "This color doesn't meet accessibility contrast
  requirements against [surface]" and blocked from saving as a *default* (an explicit
  "save anyway" override is available for a host-page-level widget override only,
  since that surface is outside NextBot's own accessibility guarantee).
- Logo upload: accepts SVG/PNG, max 2 MB, auto-generates a favicon if none is
  supplied separately. Missing/failed logo upload falls back to the tenant name as
  text wordmark, never a broken image icon.
- Live preview: the Branding screen shows a live preview of the widget launcher,
  widget window header, and (if white-labeling is enabled) the admin console top bar
  with the in-progress color/logo changes, before saving.

### 4.8 Security (`SEC-`)

**FR-SEC-02 — Credential Vaulting.** All connector/channel/model-provider credentials
(API keys, OAuth tokens, System User tokens) are stored encrypted at rest, shown only
masked in any UI, and are rotatable/revocable but never plaintext-readable from the
console after initial entry.

**FR-SEC-03 — Authentication, SSO, MFA.** Admin login supports email+password or
SSO (SAML/OAuth2), with configurable per-role MFA enforcement (TOTP authenticator,
SMS, or email, with backup codes).
- Exceeding a configurable failed-login threshold (default 5) locks the account for a
  configurable cooldown (default 15 min) and shows "Too many failed attempts — try
  again in a few minutes," distinct from "incorrect password."

**FR-SEC-04 — PII Detection & Masking.** Configurable detection rules (national ID,
credit card, IBAN, phone, email, passport, DOB, plus custom regex/keyword patterns)
apply masking per a context matrix (transcript / tool-call payload / A2A payload /
export / human-agent view) at one of Show/Partial Mask/Full Mask/Redact, with masking
intensity additionally driven by a per-connector trust level (Trusted/Semi-Trusted/
Untrusted).

**FR-SEC-05 — Data Residency Enforcement.** Data for a tenant configured to a given
region must not be stored or transiently processed (beyond stateless in-flight model
calls) outside that region without explicit tenant opt-in.

**FR-SEC-06 — Tool Permission Enforcement.** The runtime enforces the permission scope
matrix (FR-MCP-04) at call time, not just at the UI/config layer — a tool call
attempted by the agent that does not match an Allow rule (or matching backend-type
default) is rejected by the runtime itself before reaching the MCP server.

**FR-SEC-07 — A2A Trust Boundary.** Inbound A2A task requests are only accepted from
agents present in the Trusted Agents registry (FR-A2A-05) with valid, unexpired
credentials; all others are rejected with a generic "untrusted agent" response (no
detail leaked about why).

### 4.9 Reporting & Analytics (`RP-`)

**FR-RP-01 — Channel Performance Reporting.** Volume, resolution rate, avg handling
time, abandonment rate, CSAT (if survey enabled) — filterable by date range,
channel(s), language, with AI-deflection-by-channel breakdown and drill-down to
escalation-driving goals.

**FR-RP-02 — Tool Call Analytics.** Volume, success rate, latency (p50/p95/p99), error
breakdown by tool/backend, with per-tool latency histogram and top-calling goals.

**FR-RP-03 — Goal/Capability Coverage & Gap Analysis.** Per-goal AI-resolved % vs.
escalated %, with a goals × channels heatmap highlighting >30% escalation rate as
candidates for improvement, plus top escalation reasons and suggested improvements
per goal.

**FR-RP-04 — AI Resolution Rate.** Percentage of conversations resolved without human
escalation, tracked as a headline dashboard metric with trend.

**FR-RP-05 — A2A Task Reporting.** Inbound/outbound task volume, completion rate, avg
duration, failure reasons.

**FR-RP-06 — SLA Compliance Reporting.** See FR-TCK-07 (passthrough from ticketing
backend).

**FR-RP-07 — AI Cost Reporting & Budget Controls.** Total AI credits/tokens consumed,
cost per resolved conversation, cost by channel/backend/goal/tool, budget cap with
alert thresholds (80/90/100%) and an auto-throttle policy when the cap is exceeded.
- When auto-throttle triggers, in-flight conversations are not abruptly cut off;
  new conversation starts on that tenant receive a configured degraded-mode response
  (e.g., FAQ-only via knowledge base, or immediate escalation to human) rather than a
  raw error.

**FR-RP-08 — Conversation Trace & Debugging.** Full per-conversation trace: transcript
with reasoning blocks, tool-call timeline (input/output JSON, latency, status), raw
event log, confidence trend — replayable in the Sandbox Test Console with the same
inputs pre-loaded.

### 4.10 Agent Platform Architecture (`AGT-`)

**FR-AGT-01 / FR-AGT-02 — Agent Definition Registry.** Every agent definition
(support-triage, escalation-summarizer, per-tenant custom agents) is a versioned
(semver) YAML+code artifact with an approval pipeline: `Draft → Eval-Gated → Human
Review → Approved → Production`, with git-style diff between any two versions.
- A definition cannot move to `Production` status without passing its bound eval
  suite (FR-AGT-06) — this gate is enforced by the registry itself, not just a UI
  convention (i.e., the promotion action is unavailable, not merely "discouraged," if
  the gate fails).

**FR-AGT-03 — Code-First Agent Builder.** A chat-driven authoring surface writes/edits
Agent Definitions from a natural-language brief, offers a sandboxed dry-run simulation
against the in-progress definition (never touching production), and converges every
edit (chat-authored or hand-edited) into the same Git-diff-reviewed artifact as the
visual Dialogue Flow Designer.

**FR-AGT-04 / FR-AGT-05 — Deployment & Canary Management.** Per agent/environment,
admins configure active version and optional traffic split across versions (e.g. 90/10
canary), with "Promote canary to 100%" and instant "Rollback" (repoint, not redeploy)
actions, and a full rollout history (who/when/from/to/reason).
- Rollback must complete (repoint traffic) within a bounded time (target: <5s from
  action to new version serving traffic) since it is the primary mitigation for a bad
  deploy — this is captured as NFR-2.

**FR-AGT-06 — Eval Suite Gating.** Every agent version has a bound golden-set eval
suite (test case: input transcript, expected tool calls, expected response pattern,
cost/latency budget); pass rate and per-test-case diffs are viewable; suites run
automatically on every new version submitted for review and can be re-run manually.

**FR-AGT-07 / FR-AGT-08 — Model Gateway.** Single ingress for all LLM calls: per-agent
(or platform-default) primary provider/model with an ordered fallback chain, routing
strategy (cost-based / latency-based / fixed-priority), per-tenant and per-agent
rate/budget caps with hard-stop + alert thresholds, exact-match and semantic response
caching, and centralized provider-API-key vaulting (the Agent Runtime itself never
holds provider keys).
- If every provider in an agent's fallback chain is unavailable, the agent surfaces
  the tool-call/backend-timeout-class fallback message (FR-AI-05) rather than hanging
  indefinitely; a maximum end-to-end model-call timeout (default 30s across the whole
  fallback chain) is enforced.

**FR-AGT-09 / FR-AGT-10 — Runtime Observability.** Every agent run (sync, async, or
resumed-after-HITL) is listed with status, duration, token cost, and an OpenTelemetry
span trace (one span per graph node/tool call); per-agent-version rollups (usage,
cost, latency p50/p95, tool-call success rate) feed the Deployment & Canary Manager's
promotion decisions; HITL-paused runs are listed with a "Resume" action; per-tenant
concurrent-run count, tokens/min, and tool-egress allowlist status are visible to
surface multi-tenant isolation boundaries.

#### Skills and the Agent Design Studio (Module C — Blueprint §8)

**FR-AGT-11 — Skill as a Versioned Artifact.** A skill is a named, versioned YAML
bundle capturing: a natural-language trigger description, scope (capability groups +
explicit tools + knowledge collections), an instruction fragment, a success-criteria
statement, escalation conditions, and a set of eval cases.
- Skills are immutable once saved, matching the agent-version immutability invariant
  (Blueprint §3.2): editing a skill creates a new version (`refund_request@4`) and
  leaves every agent version composed with `refund_request@3` untouched.
- Validation: a skill referencing a capability group, tool, or knowledge collection
  that does not exist (or is not enabled for the tenant) fails validation at save time
  with the specific missing reference named — never saved as a dangling reference.

**FR-AGT-12 — Skill Library, Where-Used, and Upgrade-Consumers.** The Skills Library
lists all skills with version history; a skill's detail page shows a "where-used"
panel (every agent version currently composed with any version of this skill) and an
"Upgrade consumers" action that generates new **Draft** agent versions pre-composed
with the newer skill version for each consumer.
- Idempotency: "Upgrade consumers" run twice against the same skill version does not
  create duplicate drafts for a consumer that already has an un-promoted upgrade draft
  pending.
- Every generated draft goes through the full existing promotion gate (FR-AGT-01)
  normally — this action never promotes anything directly to Production.

**FR-AGT-13 — Agent Design Studio (Third Authoring Mode).** A wizard-based authoring
surface — alongside the existing Text mode and Design mode (FR-AGT-03) — walks:
Purpose & persona → Audience & channel (declares the agent's trust level, feeding the
PII masking-context matrix) → Skills (composed, version-pinned from the Skills
Library) → Tools (capability groups + explicit allow/deny, reusing the existing
simulate preview) → Knowledge (collection scopes, retrieval strategy, grounding
policy) → Guardrails & escalation (reusing tenant PII/Guardrails settings as a floor,
never a ceiling) → Model & budgets (Model Gateway v2 routes) → Memory → Evals (a suite
auto-generated from the composed skills' eval cases, editable) → Review (full YAML
preview, then save as Draft).
  - **The Studio must emit the same YAML validated by the same single validator as
    Text and Design mode, and must always land in Draft** — it must never bypass the
    eval-gate, reviewer-not-author, or sandbox-conversation conditions of the existing
    promotion gate (FR-AGT-01). A Studio-produced version that reached Production
    without passing the gate is a defect, not an accepted shortcut.
  - Regression guard: every Studio output must round-trip through Text mode unchanged
    (same YAML in, same YAML rendered back) — this is a required test property, not
    merely a nice-to-have, since divergence here is how the YAML stops being the
    single source of truth (Blueprint §14.1 "the Studio outpaces the schema" risk).

**FR-AGT-14 — Guardrail Tightening-Only Invariant.** An agent version (authored via any
of Text, Design, or Studio mode) may only **tighten** tenant-level PII masking and
guardrail policy relative to the tenant default, never loosen it.
- Validation: a version attempting to relax tenant PII masking (e.g., downgrading a
  masking-context entry from Full Mask to Show) **fails validation and cannot be
  saved as Draft**, with the specific policy field and disallowed direction named —
  this is enforced by the validator, not merely hidden in the interface (closing the
  Blueprint's explicit "must not be delegated to prompt instructions" requirement,
  §3.2/§8.3).

**FR-AGT-15 — Blueprints Gallery.** Pre-composed skill sets for common shapes (support
triage, order status, IT helpdesk) are offered as starting points; selecting one opens
the Studio pre-populated at the Review step of a working Draft, editable before save.

**FR-AGT-16 — Eval Harvesting from Production.** A conversation, an escalation, or a
denied Tier-3 approval can be promoted into an eval case in one action from its detail
view, pre-filling the transcript and expected behavior for admin confirmation before
it is added to a suite.

**FR-AGT-17 — Continuous Evals Against Production.** Scheduled eval runs execute against
the currently-deployed Production version (not only pre-promotion), to catch
model-provider drift; a run that regresses below the previously-recorded pass rate
raises an alert distinct from a pre-promotion gate failure.

**FR-AGT-18 — Rubric/Judge Grading and Regression Baselines.** In addition to today's
expected-response-pattern matching, an eval case may specify a rubric graded by a
judge model, with groundedness and citation-precision metrics available for
retrieval-scoped agents (FR-KB-06). A suite may be gated on "no worse than the
currently-deployed version" (regression baseline) in addition to, or instead of, an
absolute pass threshold.

**FR-AGT-19 — Structural YAML Diff Without Git.** Version comparison works
unconditionally between any two versions of any YAML artifact (agent version, skill,
workflow, team, model route) via a structural diff computed directly from the stored
YAML — **no Git connection or commit is required** for this baseline diff (Blueprint
§8.5, closing gap G-07, the majority-path diff gap). The existing Git-provider diff
(ADR-0009) remains available as an enriched view when a repository is connected, but
is no longer the only diff mechanism.
- The one-Git-connection-per-tenant constraint (ADR-0009) is relaxed to one connection
  per agent definition or per team, so a large tenant with separate engineering groups
  is not forced to share a single repository across all agent definitions (closes
  gap G-18).

#### Emergency Rollback (Blueprint §12.3, extends FR-AGT-04/05)

**FR-AGT-30 — Emergency Rollback.** In addition to the existing Rollback action
(FR-AGT-04/05, which repoints traffic to a version already in the same deployment's
recent history), an admin may **re-promote any previously-Production version of the
same agent definition directly to Production, bypassing the promotion gate**, on the
basis that it already satisfied the gate at the time it was first promoted.
  - Required input: a free-text reason (non-empty; validation error "A reason is
    required for emergency rollback" if blank).
  - The action writes an audit-log entry (actor, source version, target version,
    reason, timestamp) and notifies the tenant's administrators — this is not a silent
    action.
  - This is explicitly **not** a weakening of the promotion gate: it is only ever valid
    against a version that is *already* immutable and *already* has a recorded passing
    gate outcome from its original promotion; it cannot be used to promote a Draft,
    Eval-Gated, or Human-Review version.
  - Performance: repoint completes within the same bound as ordinary rollback (NFR-2,
    <5s) since this is the primary incident-recovery mechanism (Blueprint: "the
    platform can deploy faster than it can recover" — closing gap G-02, the highest
    risk-to-effort item in the Blueprint).

#### Model Gateway v2 (Module F — Blueprint §11) — supersedes the free-text portion of FR-AGT-07/08

FR-AGT-07/08's routing strategy, fallback chain, rate/budget caps, caching, and
centralized-vaulting requirements are all preserved. The following requirements
replace only the free-text model-name string with a real three-layer model, and are a
**hard prerequisite for Module B (Knowledge and Graph RAG)** — see the boxed
dependency note at the start of that section.

**FR-AGT-20 — Model Provider Registry.** Admin registers a `model_provider`: type (one
of `anthropic`, `openai`, `azure-openai`, `google-vertex`, `bedrock`, `openrouter`,
`openai-compatible`, `ollama`, or a declared custom/vendor-direct type), base URL,
auth method + credential (vaulted per FR-SEC-02, never returned in plaintext), region,
data-retention/training flags, and rate limits.
- Provider type drives the adapter and catalog-sync mechanism, not just a label (e.g.,
  `openai-compatible` covers vLLM/TGI/LiteLLM and any OpenAI-shaped self-hosted
  endpoint via one adapter).
- Self-hosted providers (`openai-compatible`, `ollama`) require no credential but do
  require a reachability check, concurrency limit, and health probe — an unreachable
  local endpoint is a distinct, alertable status, not a silent outage.
- Validation: a provider whose declared region conflicts with the tenant's residency
  configuration (FR-SEC-05) is flagged at save time, not merely at route-save time.

**FR-AGT-21 — Model Catalog.** Each provider exposes a catalog of `model_catalog_entry`
rows (model id, display name, modality, context window, max output, capability flags
[tool-calling/vision/streaming/structured-output/extended-thinking], tokenizer family,
price in/out/cached, status, deprecation date), synced automatically where the
provider exposes a listing API (OpenAI-shaped `GET /v1/models`, Azure deployment list,
Bedrock foundation-model list, Ollama `GET /api/tags`, etc.) and declared manually for
providers without one.
- A **route selects a catalog entry; it never stores a typed model-name string** — this
  is the specific change that closes gap G-05.
- A model entering `deprecating` status raises a warning badge on every route and every
  agent version that references it, showing the provider's stated end-of-life date.

**FR-AGT-22 — Model Route (Three-Layer Composition).** A named, versioned
`model_route` is an ordered chain of targets, each a `{provider, catalog_entry,
params}` tuple, with declared failover conditions (e.g. `[429, 5xx, timeout]`), retry
policy, per-hop and total timeout, cache mode, a per-turn cost ceiling, and residency
policy (`allowOutOfRegionFailover`, default `false`).
- **Capability validation happens at save time, not at runtime**: an agent version
  that declares a required capability (e.g., tool calling) is rejected at save if the
  primary — or any — hop of its bound route does not support that capability. A
  route's advertised capability set is the intersection across all hops in its chain
  (the weakest hop wins) — a fallback that would silently drop tool-calling support is
  a save-time validation failure, not a runtime surprise.
- Routes are versioned; an agent version pins `route@version`, so editing a route
  never changes the behavior of an already-promoted agent version.
- If every hop in a route's chain is unavailable, the agent surfaces the existing
  backend-timeout-class fallback (FR-AI-05) within the existing end-to-end timeout
  bound (FR-AGT-07/08, default 30s) — unchanged from today.

**FR-AGT-23 — Per-Role Standard Routes.** The platform recommends (not mandates) a
standard set of route names by role: `chat.primary` (answering), `chat.router`
(cheap-model classification/routing — the load-bearing route for Module E's
supervisors, FR-ORC-*), `embed.default` (knowledge indexing), `rerank.default`
(retrieval reranking), `vision.default`.

**FR-AGT-24 — Tenant Usage & Cost View.** A tenant-facing usage report (closing gap
G-11) shows spend and volume by provider, model, route, agent version, and channel,
with a cost-per-resolved-conversation figure, distinct from and in addition to the
Platform-Manager-only quota view (NFR-4a). Budget-breach behavior (degrade to a
cheaper hop, or fail) is declared at the route level and is visible before, not
discovered at, the breach.

**FR-AGT-25 — Provider Residency & Data-Handling Enforcement.** A route whose chain
would send tenant data to a provider/region outside the tenant's configured residency
setting cannot be saved (extends FR-SEC-05 to the model layer); each provider's
prompt-retention and training-usage flags are recorded, and a route surfaces the
**strictest** flag found across its chain.

**FR-AGT-26 — Plan-Tier Provider Restriction.** The Platform Manager console (existing
cross-tenant operator surface, FR-ADM/NFR-11) governs which provider **types** a given
plan tier (NFR-4a) may attach — e.g., restricting bring-your-own/self-hosted endpoint
types to Growth/Enterprise tiers is a configurable policy, not a hard product rule (see
open decision, §9.5).

**FR-AGT-27 — Embedding Model Pinning (cross-reference).** See FR-KB-03 — a knowledge
index generation records its exact embedding provider + catalog entry from this
module; this is the specific mechanism that makes Module F a hard prerequisite for
Module B.

### 4.11 Knowledge Base (`KB-`)

**FR-KB-01 — Knowledge Base Configuration.** Admin connects knowledge sources (FAQ
databases, uploaded documents, crawled URLs), with sync status (last sync, article
count, failed articles) and a preview of how the AI would surface a given article.
- A failed sync for an individual article does not block sync of the remaining
  articles in that source; failed articles are listed individually with the specific
  failure reason (e.g., "Unsupported file format," "Fetch timed out").

#### Knowledge and Graph RAG (Module B — Blueprint §7)

The following requirements supersede the article-oriented framing of FR-KB-01 with a
full ingestion → graph → retrieval subsystem, organized around a new
`knowledge_collection` entity (§6.1a). FR-KB-01's source-connection and per-article
sync-status UX are retained as the entry point into `knowledge_source` management
below; nothing in FR-KB-01 is removed.

+-----------------------------------------------------------------------+
| **Non-negotiable dependency ordering (Blueprint §13 closing box)**    |
| This module MUST NOT ship, and no `knowledge_collection` may be built |
| or re-embedded, until Model Gateway v2 (FR-AGT-20–27) exists. A       |
| knowledge index pins a specific embedding provider + model catalog    |
| entry; it cannot pin a free-text model-name string.                   |
+-----------------------------------------------------------------------+

**FR-KB-02 — Knowledge Collection & Ingestion Pipeline.** Admin creates a
`knowledge_collection` (region, retention policy, trust level) and attaches sources —
uploaded files, crawled URLs, MCP resources discovered via the registry (FR-MCP-20), or
connector syncs — each carrying an ACL captured at ingestion and propagated to every
downstream chunk/entity/edge.
- Pipeline stages run in order: Ingest → Parse (text/table/OCR, tables preserved as
  structured blocks, never flattened to prose) → Chunk (configurable size/overlap,
  provenance to document/page/section) → Extract entities/relations/claims (LLM pass
  on a designated cheap model route) → Resolve (deterministic + embedding-similarity
  dedup, with a human review queue for low-confidence merges) → Build graph (nodes,
  typed edges, provenance) → Community detection (hierarchical clustering) → Community
  summaries (regenerated incrementally as membership changes) → Embed (chunks, entity
  summaries, community summaries) → Index.
- A failed stage for one source does not block ingestion of other sources in the same
  collection (same non-blocking pattern as FR-KB-01); the collection's index status is
  one of `Building`, `Ready`, `Re-embedding`, `Stale`, `Failed`.
- Boundary: a collection with zero sources is valid (empty index) — an agent scoped to
  it and required to ground answers will simply always refuse per FR-KB-06's
  `refuseWhenUngrounded`, not error.

**FR-KB-03 — Embedding Model Pinning.** Each `knowledge_index_generation` records the
exact embedding provider + `model_catalog_entry` (FR-AGT-21) and vector dimension used
to build it.
- Changing a collection's configured embedding model **never silently re-embeds in
  place**; it invalidates the current generation, requires explicit confirmation
  ("Changing the embedding model invalidates this index and requires a full
  re-embed — continue?"), and produces a new generation. Old and new generations must
  not be queried as if interchangeable (mixed vector spaces are never mixed in a single
  ranking pass).

**FR-KB-04 — Graph Explorer.** Curators can browse extracted entities, their relations,
the community each belongs to, and — for every relation — the provenance chunk it was
extracted from, so an incorrect answer can be traced back to the source sentence that
produced the wrong edge.
- Boundary: an entity with zero relations (isolated node) still renders in the
  explorer, tagged distinctly (e.g., "No relations extracted") rather than being
  hidden.

**FR-KB-05 — Four Retrieval Strategies.** A knowledge-scoped agent (or the retrieval
playground, for admins) can retrieve via exactly one of: **Vector** (top-k chunk
similarity), **Graph-local** (anchor on entities mentioned in the query, walk up to
`maxHops`, return neighbor chunks + the relation path as evidence), **Graph-global**
(map over community summaries, reduce to an answer — for broad/thematic questions), or
**Hybrid** (vector recall → graph expansion of top entities → rerank). Strategy
selection is `auto` by default (query-classifier-driven: narrow entity questions →
local, broad thematic → global, no graph anchor found → vector fallback) or explicitly
pinned per agent version.
- The retrieval playground (`/knowledge/playground`) runs one query against all four
  strategies side-by-side and reports groundedness, latency, and cost per strategy, so
  an admin can pick a default with evidence rather than guessing.

**FR-KB-06 — Bounded Retrieval Agent with `refuseWhenUngrounded`.** A retrieval-scoped
agent turn plans → retrieves → runs a sufficiency check → expands (up to
`maxExpansions`) or answers with structured citations (collection, document, chunk,
and — for graph retrieval — the relation path).
  - **`refuseWhenUngrounded: true` (the recommended default) is enforced by the
    runtime, not by prompting the model**: an answer produced with fewer than
    `minCitations` structured citations is rejected before it reaches the customer,
    and the turn instead surfaces a "grounded answer not available" fallback distinct
    from the tool-call-failure fallback (FR-AI-05).
  - Idempotency/boundedness: `maxHops` and `maxExpansions` are hard ceilings enforced
    by the executor — retrieval cannot loop indefinitely regardless of what the
    sufficiency check concludes.
  - A per-turn `budget` (`usdPerTurn`, `seconds`) is enforced by the executor; exceeding
    it truncates the retrieval loop and answers (or refuses, under
    `refuseWhenUngrounded`) with whatever evidence was gathered up to that point.

**FR-KB-07 — Citations in Conversations, Traces, and the Widget.** Every grounded
answer's structured citations render in the Conversation detail's transcript, in the
Runtime Trace (FR-RP-08/AGT-09), and in the customer-facing widget as a visible
citation affordance (link/reference chip) — the widget's *visual* citation design is
out of this spec's scope (delegated to `nexus-ux`), but *that* citations must render
customer-side is a hard requirement, not optional.

**FR-KB-08 — Knowledge Governance.** Per collection:
  - **Access control:** retrieval filters candidate chunks/entities/edges by the
    requesting agent's ACL scope **before** ranking, never after — a chunk the caller
    may not see must never influence the ranking of chunks it may see.
  - **PII:** tenant PII detection rules (FR-SEC-04) run at ingestion time; detected
    entities are masked at index time per the collection's trust level, and
    **re-evaluated at read time** against the requesting agent's trust level (so the
    same indexed chunk can render differently masked to different callers).
  - **Residency:** the index, graph store, and embedding provider must all satisfy the
    tenant's configured storage region and out-of-region-inference setting (FR-SEC-05);
    a collection configuration that would send chunks out of region is rejected at
    save time with a named region-mismatch error, not silently accepted.
  - **Retention:** collections inherit the tenant retention policy (FR-ADM-06); purging
    a source removes its chunks and any extracted entities with no other provenance,
    and triggers community re-summarization for affected communities.
  - **Freshness:** collections show a staleness badge; an agent version may declare a
    maximum acceptable staleness and must refuse (not silently answer from a stale
    index) when exceeded.
  - **Coverage:** a coverage report surfaces production questions that retrieved
    nothing above a relevance threshold, feeding the content backlog from real demand
    (parallels the existing FR-RP-03 gap-analysis pattern).

**FR-KB-09 — Open Decision: Conversation History as a Knowledge Source.** Whether the
knowledge subsystem may index conversation transcripts as an ingestible source is
**explicitly left open** (Blueprint §14.2 item 4) — it interacts directly with
retention (FR-ADM-06), Data Subject Request deletion (FR-ADM-06), and the PII
masking-context matrix (FR-SEC-04), and is not resolved by this specification. See
§9.5 for the flagged-open-question list; Architecture must not silently assume either
answer.

### 4.12 Messaging Channel Specifics — Meta family (`META-`)

**FR-META-01 through META-13 — Meta Business Manager Integration.** WhatsApp
(WABA, phone numbers, messaging tier, 24h session window policy), Messenger (linked
Page), Instagram (linked professional account) are configured via a single Meta
Business Manager OAuth link; WhatsApp message templates are synced from Meta with
status (Approved/Pending/Rejected); opt-in/consent tracking with a bulk import/export
log.
- Sending a WhatsApp message outside the 24-hour customer-initiated session window
  without an approved template is rejected before send with "This message requires an
  approved WhatsApp template outside the 24-hour session window" — never silently
  dropped or silently downgraded to a different channel.
- Quick-reply chips map to WhatsApp interactive buttons (max button count/label length
  per Meta's platform limits); if a generic message exceeds WhatsApp's limits, it is
  truncated/paginated per Meta's constraints rather than failing to send.

### 4.13 General / Cross-Cutting (`GEN-`)

**FR-GEN-01 — MCP Server Marketplace/Registry Lookup.** Optionally, admins can search
a public or private MCP server directory (if configured for the tenant) as a fourth
enrollment source alongside templates/URL/Gateway Agent.

### 4.14 Workflow Designer (`WF-`) — Module D, Blueprint §9

A workflow is a new versioned orchestration graph, distinct from an agent version, for
**static** orchestration — processes knowable and reviewable in advance. It must reuse,
not duplicate, the existing promotion gate, tool tiering, and trace-viewer machinery.

**FR-WF-01 — Workflow Graph Authoring.** Admin authors a `workflow_version` as YAML
(rendered by a visual canvas, same "YAML is the artifact" principle as agent versions,
FR-AGT-03) composed of typed nodes: **Trigger** (channel event/webhook/schedule),
**Agent** (invoke a pinned `definition@version`, running with its own scope
intersected with the workflow's), **Skill** (invoke a single skill without a full
agent turn), **Tool call** (deterministic MCP call, no model in the loop), **Router**
(rule-based or classifier-based branch), **Human task** (routes into the *existing*
Approval Queue or Escalation Queue — never a third queue), **Parallel/Join** (fan-out
capped by run limits), **Loop** (bounded iteration with a mandatory hard
maximum-iteration cap — never optional/unbounded), **Sub-workflow** (invoke another
workflow version, depth-capped), **Wait** (timer or external event, requires durable
execution), and **End** (explicit terminal outcome: resolve/escalate/transfer — never
an implicit fallthrough).
- Validation: a Loop node with no configured maximum-iteration cap fails validation at
  save time ("A maximum iteration count is required for every Loop node").
- Validation: a graph with no End node reachable from every path fails validation
  ("Every path through this workflow must reach a terminal outcome").

**FR-WF-02 — Workflow Promotion Through the Existing Gate.** A workflow version is
Draft until it passes: (a) a passing eval run against the *whole graph*, (b) a
human-reviewer-not-the-author, and (c) **at least one completed sandbox run of the
whole graph** (not of individual nodes in isolation) — the identical three-part
promotion gate already enforced for agent versions (FR-AGT-01). No workflow may reach
Production by any other path.

**FR-WF-03 — Tool Tiering Survives Orchestration.** A Tier-3-classified tool invoked
from inside *any* workflow node (Agent, Skill, or direct Tool-call node) still stops at
the existing Approval Queue and does not execute until a human approves it
(FR-MCP-05) — this must be enforced in the tool executor itself, below the
orchestration layer, not merely assumed of well-behaved graph authors (Blueprint
§14.1: "orchestration becomes a path around tool tiering" is called out as the primary
risk this module introduces).

**FR-WF-04 — Idempotency and Compensation on Write Nodes.** Every write-classified
Tool-call node must declare an idempotency key strategy and a compensating action; a
workflow version with a write-classified Tool-call node lacking either fails
validation at save time ("this workflow is a distributed transaction with no
rollback path").

**FR-WF-05 — Durable, Resumable Execution.** A `workflow_run` suspended on a Human-task
or Wait node persists a checkpoint and resumes correctly after a platform restart; each
suspension type has a defined expiry behavior (e.g., an unanswered Wait node past its
configured timeout transitions the run to a declared failure/timeout outcome rather
than remaining indefinitely suspended — same pattern as the existing A2A
`input-required` timeout, FR-A2A-04/06).

**FR-WF-06 — Run-Level Budgets.** Maximum steps, cumulative cost, wall-clock duration,
and loop-iteration count are enforced by the workflow executor at run time (not merely
authored as a suggestion) — exceeding any ceiling terminates the run at a declared
failure outcome, logged distinctly from a node-level failure.

**FR-WF-07 — Workflow Traces as a Graph.** Runtime Traces (FR-RP-08) render an executed
workflow run as the path taken over the authored graph, not as a flat event list; no
separate trace viewer is built for workflows.

### 4.15 Multi-Agent Orchestration (`ORC-`) — Module E, Blueprint §10

A **team** is dynamic delegation (a supervisor decides, at runtime, which specialist
handles a turn) — strictly more capable and strictly less predictable than a workflow,
and governed accordingly. Free-form agent-to-agent messaging with no declared topology
is explicitly **not supported** — it cannot be reviewed, capped, or audited legibly.

+-----------------------------------------------------------------------+
| **Non-negotiable dependency ordering (Blueprint §13 closing box)**    |
| The permission-intersection evaluator (FR-ORC-02) and the delegation  |
| trace tree (FR-ORC-08) MUST ship before the first team runs in        |
| production. Retrofitting either onto a live multi-agent system means |
| auditing every existing team for escalation paths after the fact.     |
+-----------------------------------------------------------------------+

**FR-ORC-01 — Agent-as-Tool Registration.** A specialist agent version is registered as
an entry in the existing Tool Catalog (FR-MCP-03), with its own read/write
classification and approval tier, exactly like an MCP tool — delegation reuses the
existing per-tool permission-rule engine, simulate preview, `agent_tool_config`
visibility/priority-weight controls, and Runtime Trace tool-call recording, rather
than a parallel invocation path.

**FR-ORC-02 — Permission Composition by Intersection.** Effective scope for any
delegated call equals **the intersection** of the caller's scope, the invoked
artifact's (agent/skill/workflow-node's) declared scope, and tenant policy — permission
composition **never unions, only narrows**. This rule is implemented once, centrally,
in the platform's authorization layer and applied uniformly to workflow nodes,
delegated agents, composed skills, and retrieval calls (not re-implemented per module).
- Validation/runtime: a delegation that would grant the specialist a capability the
  supervisor itself does not hold is rejected before the call executes, not merely
  hidden in the UI.

**FR-ORC-03 — Team Definition.** A `team_version` composes exactly one supervisor
(`definition@version`, a designated cheap `chat.router`-class model route for
classification/routing — never a frontier model, per the standard-route guidance
FR-AGT-23) and one or more scoped members, each a pinned `definition@version` with a
`delegationTier` and an `invokeWhen` natural-language routing condition, plus limits:
`maxDepth`, `maxFanOut`, `maxDelegations`, a shared `runBudget` (`usd`, `seconds`), and
a required `failureMode` (`escalate` — the default and only currently specified mode;
"never silently degrade").
- Validation: a team version with no `failureMode` declared fails validation
  ("A failure mode is required — delegation must never silently degrade").
- Members are pinned by version; promoting a member's underlying agent definition to a
  new version never silently changes a production team's behavior — the team must be
  edited (new team version, re-gated) to pick up the new member version.

**FR-ORC-04 — Tier-3 Survives Every Delegation Hop.** A Tier-3 tool call made by any
team member, at any delegation depth, still stops at the existing Approval Queue; the
Approval Queue must display the full delegation chain that produced the request (which
supervisor delegated to which specialist, and why) so an approver has enough context
to make a real decision, not just the terminal agent's name.

**FR-ORC-05 — PII Re-Evaluation at Every Agent Boundary.** The masking-context matrix
(FR-SEC-04) is re-evaluated at every hand-off boundary, keyed to the *receiving*
agent's declared trust level — a supervisor holding unmasked PII may not pass a full
unmasked transcript to a lower-trust specialist by composition.

**FR-ORC-06 — Single Escalation Per Conversation, Full Chain Attached.** One
conversation raises exactly one active `Escalation` record even when multiple team
members independently trip an escalation condition in the same run; the escalation
record carries the full delegation chain, and the human takeover panel (FR-ESC-02)
renders the whole delegation tree, not just the terminal agent.

**FR-ORC-07 — Shared, Enforced Run Budgets.** `maxDepth`, `maxFanOut`,
`maxDelegations`, cumulative cost, and wall-clock are enforced by the delegation
executor at run level (not per-member) — a supervisor that would re-delegate on
failure past any limit is halted and routed to `failureMode`, never left to loop.
- Boundary: a team's routing-thrash pattern (repeated delegation to the same member
  with a materially similar payload) is detected and capped, escalating rather than
  looping.

**FR-ORC-08 — Delegation Trace Tree.** Runtime Traces render a delegated run as a tree:
which agent handled which span, the delegation reason, per-agent token/cost
attribution, and the run total — a wrong answer in a multi-agent run must be traceable
to the specific hop that produced it. The Audit Log (FR-ADM-03) records actor
attribution as a chain (e.g., "billing_agent@9, delegated by triage@14, on
conversation 4471"), never a bare terminal-agent name.

**FR-ORC-09 — Injection Guardrail Crosses Delegation Boundaries.** Output guardrails on
tool results (FR-SEC-09) run **before** a tool result or retrieved chunk crosses a
delegation boundary into another agent's context, not only before it reaches the
customer — attacker-controlled content returned by a Fetch-class connector must not
inherit the receiving specialist's trust by delegation.

**FR-ORC-10 — Specialist Fallback and "Not Mine" Return Path.** Each team member may
declare a fallback (another member, or escalate) for when it is unavailable (deprecated
pinned version, or its underlying connector offline) — the supervisor never silently
answers without the intended specialist. A specialist may return an explicit "not
mine" outcome (a first-class traced result, not an error) when invoked outside its
actual competence, distinct from a failure.

**FR-ORC-11 — Sandbox Runs the Whole Team.** The promotion-gate sandbox-conversation
requirement (FR-AGT-01, extended to teams per the same "immutable versions/promotion
gate" invariant) for a team version must exercise the **whole team topology** with a
visible delegation tree — a supervisor-only sandbox run does not satisfy the gate,
since it proves nothing about specialist behavior.

### 4.16 Cross-Cutting Guardrails and Platform Controls (Blueprint §12)

**FR-SEC-08 — Permission Intersection Evaluator (Cross-Reference).** See FR-ORC-02 —
the single, centrally-implemented authorization evaluator applies uniformly across
skills, workflows, teams, and knowledge retrieval; it is specified once here as a
platform-wide control, not per-module.

**FR-SEC-09 — Output-Side Guardrails.** In addition to today's inbound-only PII
detection and pre-tool-call blocking (FR-SEC-04, FR-AI-10/11), three new guardrail
classes act on what comes **back**, not only on what goes in: (a) **Prompt-injection
detection** on inbound customer messages **and, critically, on tool results and
retrieved knowledge chunks** before they re-enter model context (closing gap G-04 — a
Fetch-class connector today can return attacker-controlled text straight into the
model with no guard); (b) **Output policy** screening agent responses (toxicity,
off-topic drift, disclosure of entities that should have been masked) before they
reach the customer or cross a delegation boundary (FR-ORC-09); (c) **Groundedness
check**, enforcing `refuseWhenUngrounded` (FR-KB-06) for any agent with a knowledge
scope, by the runtime rejecting an ungrounded answer rather than trusting the model to
abstain.
- Validation/failure mode: a response failing the output-policy check is replaced with
  a specific, distinct fallback message (not silently sent, not indistinguishable from
  the existing FR-AI-05 fallback classes) and logged to the Audit Log with the
  guardrail that fired.

**FR-ADM-08 — Configuration Export and Restore.** A tenant admin can export the
tenant's full agent/skill/workflow/team/connector/route/policy configuration as a
versioned bundle and restore from a prior export — distinct from and in addition to
data retention/residency purge controls (FR-ADM-06), which govern *what is kept and
where*, not recoverability of *configuration*.
- Boundary: restoring a bundle never overwrites in place; it creates new Draft
  versions of restored artifacts, which must re-enter the promotion gate normally —
  restore is not a bypass mechanism.

**FR-ADM-09 — Consented Break-Glass Operator Access.** A NextBot Platform Operator may
request time-boxed, explicitly-consented, doubly-audited (on both the operator's and
the tenant's audit trail, per the existing separate-audit-trails invariant, Blueprint
§3.2) access to a specific tenant's data for incident diagnosis — the existing
cross-tenant health rollup (NFR-11) remains deliberately metadata-only; this is an
additive, opt-in escalation path, not a relaxation of that rollup's scope.
- Validation: an operator access request with no tenant-side consent grant is denied
  at the platform level, fail-closed, regardless of operator role.

**FR-ESC-05 — Escalation Workforce Mechanics.** Extending the existing Escalation
Queue (FR-ESC-01/02/03), queue items support: explicit **assignment/claiming** by a
human agent, **SLA timers with aging indicators**, agent **availability/presence**
status, **per-agent concurrency limits** (a human agent cannot be assigned past their
configured concurrent-conversation ceiling), and **CSAT capture** at the close of a
takeover — feeding both reporting (FR-RP-01) and the eval-harvesting loop (FR-AGT-16).
- Boundary: a queue with zero available (present) agents does not silently accept
  unbounded assignments — new escalations still route per FR-ESC-03's rules and wait
  visibly rather than routing to an agent already at their concurrency ceiling.

**FR-OC-08 — Cross-Channel Identity Resolution.** Where a tenant configures a
cross-channel customer identifier mapping (e.g., verified phone number linking a
WhatsApp conversation to a web-widget session), NextBot may treat both as the same
underlying customer identity for context continuity — this is an explicit, tenant-opt-in
configuration, never an automatic/inferred merge, since incorrectly merging two
different customers is a worse failure than not merging them.

### 4.17 Identity, API, and Developer Surface (`API-`) — Blueprint §12.6

**FR-SEC-10 — SSO (SAML/OIDC) and SCIM Provisioning.** In addition to the existing
SAML/OAuth2 SSO (FR-SEC-03), SCIM-based automated user/role provisioning is supported,
and per-tenant session listing/revocation, service accounts, and scoped API keys are
manageable from Settings.

**FR-API-01 — Public API.** Agent versions, skills, workflows, teams, and knowledge
sources are manageable programmatically via a documented API, authenticated via the
scoped API keys of FR-SEC-10, subject to the same permission-module gating as the
console (FR-ADM-02) — the API is not a side-door around RBAC.

**FR-API-02 — Outbound Webhooks.** Tenants may subscribe to outbound webhook events for:
escalation created, approval pending, guardrail tripped, deployment changed, and drift
detected (FR-MCP-18) — each delivered at-least-once with a retry/backoff policy and a
per-tenant delivery-log for debugging failed deliveries.

**FR-ADM-10 — OpenTelemetry and SIEM Export.** Tenant-scoped OpenTelemetry trace/metric
export and audit-log streaming to a tenant-configured SIEM endpoint are available as
opt-in Settings configuration, additive to the existing in-console trace/audit
experience (FR-RP-08, FR-ADM-03) — never a replacement for it.

---

## 5. Non-Functional Requirements

**NFR-1 (Availability).** Target 99.9% uptime for the AI agent runtime and channel
ingress paths (Widget, WhatsApp, etc.) per tenant, excluding scheduled maintenance
windows communicated at least 48h in advance.

**NFR-2 (Performance — Conversational Latency).** Median end-to-end response latency
(customer message received → first token of AI response streamed back) under 2.5s for
Tier-1 (no external tool call) turns; under 6s p95 for turns involving one MCP tool
call to a healthy backend. Rollback of a bad agent deployment must complete (repoint
traffic) in under 5 seconds from action.

**NFR-3 (Scalability).** The platform must support (per representative large tenant)
at least 10,000 concurrent active conversations and 500 tool calls/second sustained
across all its connectors, with horizontal scale-out of the Data Plane (Agent Runtime)
independent of Control/Gateway/Observability planes.

**NFR-4 (Multi-Tenant Isolation).** No tenant's data, credentials, conversations, or
agent-run load may be visible to, or able to degrade the service of, another tenant.
Concurrent-run quotas and tool-egress allowlists (FR-AGT-10) are enforced per tenant
so one tenant's load cannot starve another's. **This isolation strategy is a
configurable/open architectural decision** — options include fully separate database
schemas per tenant, row-level-security with a shared schema and tenant-ID scoping, or
separate logical databases per tenant tier — and is deferred to the Architecture phase
to select and document as an ADR, not fixed here.

**NFR-4a (Plan Tiers & Quota Defaults).** Every tenant is provisioned onto exactly one
named plan tier, which fixes the default values enforced by NFR-4's per-tenant quotas
(all values below are per-tenant soft defaults stored as configuration rows — tunable
per tenant without a schema change, and revisable once real production usage data
exists; resolved by user decision, 2026-08-15):

| Tier | Target tenant | Messages/month | Tool calls/min | Concurrent conversations | MCP connectors | Isolation |
|---|---|---|---|---|---|---|
| **Starter** | SMB, single backend | 10,000 | 60 | 50 | 3 | Shared schema (RLS) |
| **Growth** | Mid-market, multi-team | 100,000 | 300 | 500 | 15 | Shared schema (RLS) |
| **Enterprise** | Large/regulated | Unlimited* | 1,000 | 5,000 | Unlimited | Dedicated database (escape hatch, see Architecture ADR-0001) |

*Enterprise "unlimited" means a contractually negotiated cap enforced as a very high
configurable ceiling — never literally uncapped, since NFR-4's cross-tenant
degradation guarantee must hold even for the largest tenant.
- A tenant exceeding its tier's message/tool-call quota does not hard-fail; per
  FR-RP-04's cost-control pattern, it is throttled with a distinct "quota exceeded for
  your plan" response (not a generic error) and an alert to the tenant admin, with
  concurrent-conversation and MCP-connector-count ceilings enforced at
  creation/connection time with a clear "upgrade your plan" message rather than a
  silent rejection.
- Tier is set at tenant provisioning and changeable by a NextBot Platform Operator
  (or, later, self-service plan upgrade — not required for MVP).

**NFR-5 (Security & Compliance).** All data encrypted in transit (TLS 1.2+) and at
rest (AES-256 or equivalent). Credentials never stored or displayed in plaintext post-
entry (FR-SEC-02). Support for SOC 2-style audit-log completeness (FR-ADM-03). Where a
tenant operates in a jurisdiction with data-protection law (e.g., GDPR, UAE PDPL), the
Data Subject Request tooling (FR-ADM-06) and PII masking (FR-SEC-04) must be
sufficient to support compliance obligations — NextBot itself is not a compliance
guarantee, it is the enabling control set.

**NFR-6 (Data Residency).** Storage region must be configurable per tenant from at
minimum: UAE, EU, US (extensible list); once set, changing a tenant's region is a
guarded migration operation requiring confirmation and is out of MVP scope to automate
(manual/assisted migration acceptable at launch).

**NFR-7 (Accessibility).** The Widget and Admin Console must meet WCAG 2.2 AA:
keyboard navigability, screen-reader labeling on all interactive elements, color
contrast ratios, and respect for `prefers-reduced-motion` (explicitly called out for
the launcher animation, FR-OC-01).

**NFR-8 (Internationalization / RTL).** The Widget supports 40+ configurable
languages, full RTL layout mirroring (not just text direction) for RTL languages, and
per-language configurable strings for all tenant-authored content (quick actions,
menu items, header titles, nudge messages).

**NFR-9 (Observability).** Every agent run must produce an OpenTelemetry-compatible
trace exportable to a tenant's or the platform's APM; every tool call, escalation, and
approval decision must be traceable end-to-end from customer message to backend
mutation and back (FR-RP-08, FR-MCP-06).

**NFR-10 (Auditability & Immutability).** Audit log entries (FR-ADM-03) are append-
only; approval decisions and tool-call records must be immutable once written, with
any correction represented as a new compensating record, never an edit/delete.

**NFR-11 (Operability).** The platform must expose sufficient internal tooling
(tenant provisioning, cross-tenant capacity dashboards) for the NextBot Platform
Operator role to manage the SaaS fleet; detailed internal-ops tooling design is
deferred to the Architecture phase (not part of MVP screen scope) but the requirement
for tenant isolation and quota enforcement (NFR-4) must be operator-observable.

**NFR-12 (Extensibility).** New MCP connectors (backend integrations), new channels,
and new orchestration-graph frameworks (LangGraph, Pydantic AI, Google ADK, custom
FSM) must be addable without core platform redeployment, per the pluggable
architecture described in the engineering appendix of the screen inventory.

**NFR-13 (Rollback Recovery Time — Emergency Rollback).** Per FR-AGT-30, re-promoting
a previously-Production agent version via emergency rollback must complete (repoint
traffic) within the same bound as ordinary rollback (NFR-2, <5s from action), since
this is the platform's primary incident-recovery mechanism for a bad deployment
(Blueprint §12.3 / gap G-02).

**NFR-14 (Manifest Drift Detection Latency).** The MCP manifest-drift reconciler
(FR-MCP-18) must re-check each enrolled server's live manifest against its pinned hash
at least once per configurable interval (default: hourly), so that an unreviewed
schema/tool change is quarantined within a bounded window rather than persisting
undetected indefinitely.

**NFR-15 (Retrieval Latency and Cost Ceilings).** A bounded retrieval agent turn
(FR-KB-06) must respect its declared per-turn budget (`usdPerTurn`, `seconds`) as a
hard ceiling enforced by the executor; default recommended ceilings are $0.02/turn and
8 seconds, tunable per agent version.

**NFR-16 (Multi-Agent Run Cost and Depth Ceilings).** A delegated team run
(FR-ORC-03/07) must respect its declared `runBudget`, `maxDepth`, `maxFanOut`, and
`maxDelegations` as hard, executor-enforced ceilings — a supervisor-plus-specialists
run must not be able to cost or run an unbounded multiple of a single-agent turn
(Blueprint §14.1: multi-agent cost runaway is an explicitly named risk).

**NFR-17 (Enterprise Identity Readiness).** SSO (SAML/OIDC) and SCIM provisioning
(FR-SEC-10) must be available as a plan-tier-gated capability (at minimum for
Enterprise tier, NFR-4a) — password+TOTP-only authentication is treated as an
enterprise-procurement blocker independent of product quality (Blueprint gap G-12) and
must not be the only option once this module ships.

**NFR-18 (Configuration Recoverability).** A tenant's exported configuration bundle
(FR-ADM-08) must be restorable into a new set of Draft artifacts without data loss of
the original artifact's authored content (YAML, policy, scope) — restoration fidelity
is a hard requirement even though restored artifacts must re-enter the promotion gate
before taking effect.

---

## 6. Data Model

### 6.1 Core Entities

**Tenant**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| name | string | required, unique | |
| region | enum(UAE, EU, US, …) | required | data residency (NFR-6) |
| status | enum(Active, Suspended, Trial) | required | |
| plan_tier | enum(Starter, Growth, Enterprise) | required, default Starter | NFR-4a; fixes default quota values (message/mo, tool calls/min, concurrent conversations, MCP connector count, isolation strategy) |
| created_at | timestamp | required | |
| default_language | string (ISO-639) | required | |
| branding_config | JSON | optional | platform brand profile (FR-ADM-07): primary/secondary color, logo URLs (light/dark), favicon, font family — default source of truth for widget theme and, when white-labeling is enabled, admin/developer portal chrome |
| white_label_enabled | boolean | default false, plan-gated | when true, branding_config also overrides default NextBot chrome in Admin/Developer Portals (FR-ADM-07) |

**User** (Admin Console user)
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK → Tenant, required | |
| email | string | required, unique per tenant | |
| roles | array<Role.id> | at least 1 for active login (FR-ADM-02) | |
| mfa_enrolled | boolean | required | |
| sso_subject | string | optional | SSO-linked identity |
| status | enum(Active, Locked, Disabled) | required | |

**Role**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK → Tenant | |
| name | string | required | |
| permission_matrix | JSON (module → Read/Write/None) | required | FR-ADM-02 |

**Channel**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK → Tenant | |
| type | enum(WebWidget, WhatsApp, Messenger, Instagram, Voice, Email, SMS, Slack, Teams) | required | |
| status | enum(Active, Inactive, Error) | required | |
| config | JSON | type-specific schema | |
| environment | enum(Sandbox, Staging, Production) | required | |

**Connector (MCP Server)**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK → Tenant | |
| name | string | required, unique per tenant+environment | |
| backend_type | enum(Ticketing, CRM, ERP, Billing, HRIS, KnowledgeBase, Custom) | required | |
| transport | enum(StreamableHTTP, StdioViaGateway) | required | |
| auth_method | enum(OAuth2, APIKey, BearerToken, CustomHeader, mTLS) | required | |
| credential_ref | UUID | FK → Credential (vaulted, never inline) | FR-SEC-02 |
| environment | enum(Sandbox, Staging, Production) | required | |
| status | enum(Connected, Degraded, Offline) | computed | FR-MCP-01 |
| gateway_agent_id | UUID | FK → GatewayAgent, nullable | only if StdioViaGateway |

**Tool**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| connector_id | UUID | FK → Connector | |
| name | string | required | source tool name from MCP server |
| display_name | string | optional override | |
| description | string | required; overridable | agent-facing selection text |
| input_schema | JSON Schema | required | |
| output_schema | JSON Schema | required | |
| rw_class | enum(Read, Write) | required, auto-classified + overridable | |
| approval_tier | enum(Tier1, Tier2, Tier3) | required, default by rw_class+backend_type | FR-MCP-05 |
| visible_to_agent | boolean | default true | FR-MCP-13 |
| priority_weight | int 1–100 | default 50 | FR-AI-02 |
| capability_group_id | UUID | FK → CapabilityGroup, nullable | |
| status | enum(Active, Disabled, Error) | required | |

**CapabilityGroup**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| name | string | required |
| guidance_text | text | optional |

**Conversation**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK → Tenant | |
| channel_id | UUID | FK → Channel | |
| customer_identifier | string | nullable (anonymous allowed) | |
| status | enum(Active, Resolved, Escalated, Abandoned) | required | FR-AI-06 |
| recognized_goal | string | nullable | |
| resolution_type | enum(AI, Human, Abandoned) | nullable until closed | |
| started_at / ended_at | timestamp | required / nullable | |
| language | string | required | |

**Message**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| conversation_id | UUID | FK → Conversation |
| sender | enum(Customer, AI, HumanAgent, System) | required |
| content_type | enum(Text, QuickReply, List, ExternalLink, Document, DataSummary, DataTable, Form, OTP, Confirmation, TicketCreated, TicketStatus, FileUpload, Error) | required |
| payload | JSON | schema per content_type | |
| confidence_score | float 0–1 | nullable, AI messages only | FR-AI-07 |
| created_at | timestamp | required | |

**ToolCall**
| Field | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID | PK | |
| conversation_id | UUID | FK → Conversation, nullable (A2A-originated calls may lack one) | |
| tool_id | UUID | FK → Tool | |
| approval_tier | enum(Tier1, Tier2, Tier3) | required, snapshot at call time | |
| approval_status | enum(NotRequired, Pending, Approved, Rejected) | required | FR-MCP-05 |
| idempotency_key | string | required, unique | FR-MCP-05 |
| input_args | JSON | PII-masked per context | |
| output | JSON | nullable until complete | |
| status | enum(Success, Failed, Pending) | required | |
| latency_ms | int | nullable until complete | |
| created_at | timestamp | required | |

**Escalation**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| conversation_id | UUID | FK → Conversation |
| reason | enum(LowConfidence, ToolFailure, CustomerRequest, SensitiveTopic) | required, non-null (FR-ESC-01) |
| queue | string | required (routed or fallback default) |
| assigned_agent_id | UUID | FK → User, nullable until taken |
| status | enum(Waiting, InProgress, Resolved, ReturnedToBot) | required |

**AgentDefinition**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant, nullable for platform-shared agents |
| name | string | required |
| version | semver string | required, unique per (name) |
| graph_type | enum(LangGraph, PydanticAI, ADK, CustomFSM) | required |
| status | enum(Draft, EvalGated, HumanReview, Approved, Production, Deprecated) | required |
| definition_yaml | text | required (Git-tracked artifact) |
| eval_suite_ref | string | required before Production (FR-AGT-01) |

**Deployment**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| agent_definition_id | UUID | FK → AgentDefinition |
| environment | enum(Dev, Stage, Prod) | required |
| traffic_split_pct | int 0–100 | required, sums to 100 across co-deployed versions per environment |

**Credential** (vault reference only — no plaintext field ever modeled/stored in the app schema)
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| type | enum(APIKey, OAuthToken, SystemUserToken, BearerToken) | required |
| vault_ref | string | required (opaque pointer into secrets manager) |
| last_rotated_at | timestamp | required |
| expires_at | timestamp | nullable |

**AuditLogEntry**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| actor | string (user id, "system", or "ai_agent") | required |
| action_type | enum(ConfigChange, ToolCall, Login, Escalation, A2ATask, ApprovalDecision) | required |
| target | string | required |
| detail | JSON (PII-masked) | required |
| outcome | enum(Success, Failure, Pending) | required |
| created_at | timestamp | required, immutable |

**A2ATask**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| direction | enum(Inbound, Outbound) | required |
| counterpart_agent_id | UUID | FK → TrustedAgent |
| status | enum(Submitted, Working, InputRequired, Completed, Failed) | required |
| conversation_id | UUID | FK → Conversation, nullable |
| payload | JSON | required |

**TrustedAgent**
| Field | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| identity_uri | string | required, unique per tenant |
| trust_level | enum(Full, Restricted) | required |
| credential_ref | UUID | FK → Credential |
| status | enum(Active, Revoked) | required |

### 6.1a Blueprint-Derived Entities (Modules A–F)

These entities extend the core model in §6.1 without altering any existing entity's
fields (except where noted). All new entities are tenant-scoped (`tenant_id` FK) unless
marked platform-shared.

**Note on CapabilityGroup reconciliation.** §6.1's existing `CapabilityGroup` and
`Tool.capability_group_id` (one group per tool) already cover most of Module A's
`capability_group` entity. The Blueprint additionally models a `capability_group_item`
bridge table (`group_id, server_id, tool_name`) implying a tool may belong to **more
than one** capability group. This is a genuine, small schema decision for Architecture
to resolve: either (a) keep the existing single-FK model (simpler, matches today's
Design-mode picker), or (b) introduce the bridge table for multi-group membership. Not
resolved here — flagged in §9.5.

**MCP Registry (Module A)**

| Entity | Key fields |
|---|---|
| `mcp_server` | id, tenant_id, name, backend_type, criticality, owner, status, created_by — supersedes/wraps today's `Connector` as the enrolment-lifecycle parent |
| `mcp_server_version` | id, server_id, version, transport, auth_method, credential_ref, policy_json, manifest_hash, approved_by, approved_at |
| `mcp_environment_binding` | id, server_version_id, environment, endpoint_url, credential_ref, reachable_at |
| `mcp_manifest_item` | id, server_version_id, kind (tool\|resource\|prompt), name, schema_json, schema_hash, io_class, approval_tier, enabled |
| `mcp_drift_event` | id, server_id, detected_at, change_kind, item_name, old_schema_hash, new_schema_hash, resolution, resolved_by |

**Knowledge and Graph RAG (Module B)**

| Entity | Key fields |
|---|---|
| `knowledge_collection` | id, tenant_id, name, region, retention_days, trust_level, status |
| `knowledge_source` | id, collection_id, kind (upload\|url\|mcp_resource\|connector), locator, acl_json, last_synced_at |
| `knowledge_index_generation` | id, collection_id, generation, embedding_provider_id, embedding_model_id, dimension, built_at, status |
| `knowledge_chunk` | id, generation_id, source_id, ordinal, text, acl_json, pii_mask_json, vector_ref |
| `graph_entity` | id, generation_id, canonical_name, type, summary, community_id, degree |
| `graph_edge` | id, generation_id, src_entity_id, dst_entity_id, relation, weight, provenance_chunk_id |
| `graph_community` | id, generation_id, level, parent_id, title, summary, entity_count |
| `retrieval_event` | id, conversation_id, agent_version_id, strategy, hops, chunk_ids, citation_ids, latency_ms, cost_usd, grounded |

**Skills (Module C)**

| Entity | Key fields |
|---|---|
| `skill` | id, tenant_id (nullable if platform-shared — see open decision §9.5), name, status |
| `skill_version` | id, skill_id, version, yaml, trigger, capability_groups_json, tools_json, knowledge_json, instructions, success_criteria, escalate_when_json, eval_case_refs_json, status |

**Workflow Designer (Module D)**

| Entity | Key fields |
|---|---|
| `workflow` | id, tenant_id, name, description, status |
| `workflow_version` | id, workflow_id, version, yaml, graph_json, status, created_by, approved_by, eval_run_id, sandbox_run_id |
| `workflow_run` | id, workflow_version_id, conversation_id, state, checkpoint_json, started_at, ended_at, cost_usd, outcome |
| `workflow_run_step` | id, run_id, node_id, node_kind, ref_version, started_at, ended_at, status, cost_usd, trace_span_id |

**Multi-Agent Orchestration (Module E)**

| Entity | Key fields |
|---|---|
| `team` | id, tenant_id, name, description, status |
| `team_version` | id, team_id, version, supervisor_definition_version_id, limits_json, failure_mode, yaml, status, approved_by |
| `team_member` | id, team_version_id, definition_version_id, delegation_tier, invoke_when, fallback_member_id |
| `delegation_event` | id, conversation_id, run_id, parent_span_id, from_agent_version_id, to_agent_version_id, reason, depth, cost_usd, outcome |

**Model Gateway v2 (Module F)**

| Entity | Key fields |
|---|---|
| `model_provider` | id, tenant_id (nullable for platform-registered), type, name, base_url, region, auth_method, credential_ref, retains_prompts, trains_on_data, rate_limit_json, status |
| `model_catalog_entry` | id, provider_id, model_id, display_name, modality, context_window, max_output, capabilities_json, tokenizer, price_in, price_out, price_cached, status, deprecates_at |
| `model_route` | id, tenant_id, name, description — supersedes the free-text model name previously implied by `AgentDefinition`/`Deployment`'s model configuration |
| `model_route_version` | id, route_id, version, chain_json, policy_json, created_by, status |
| `model_usage_event` | id, tenant_id, route_version_id, catalog_entry_id, agent_version_id, conversation_id, tokens_in, tokens_out, cached_tokens, cost_usd, latency_ms, hop_index, outcome |

### 6.2 Relationships

- Tenant 1—N { User, Role, Channel, Connector, Conversation, AgentDefinition,
  Credential, AuditLogEntry, TrustedAgent }
- Connector 1—N Tool; Tool N—1 CapabilityGroup (optional)
- Conversation 1—N Message; Conversation 1—N ToolCall; Conversation 0—1 Escalation
  (a conversation may escalate at most once per escalation cycle, though it may cycle
  Escalated → ReturnedToBot → Escalated again as separate Escalation records)
- ToolCall N—1 Tool; ToolCall 0—1 A2ATask (calls made by/for an external agent)
- AgentDefinition 1—N Deployment (across environments/versions)
- TrustedAgent 1—N A2ATask (as counterpart)

**Blueprint-derived relationships (§6.1a):**

- Tenant 1—N { mcp_server, knowledge_collection, skill (if tenant-scoped), workflow,
  team, model_provider, model_route }
- mcp_server 1—N mcp_server_version 1—N { mcp_environment_binding, mcp_manifest_item };
  mcp_server 1—N mcp_drift_event
- knowledge_collection 1—N knowledge_source; knowledge_collection 1—N
  knowledge_index_generation 1—N { knowledge_chunk, graph_entity, graph_edge,
  graph_community }; graph_entity N—1 graph_community; graph_edge N—1 knowledge_chunk
  (provenance)
- Conversation 1—N retrieval_event; retrieval_event N—1 AgentDefinition (version)
- skill 1—N skill_version; AgentDefinition (version) N—M skill_version (composition,
  version-pinned)
- workflow 1—N workflow_version 1—N workflow_run 1—N workflow_run_step;
  workflow_version N—M AgentDefinition (version) / skill_version (referenced nodes)
- team 1—N team_version 1—N team_member; team_member N—1 AgentDefinition (version, as
  supervisor or specialist); Conversation 1—N delegation_event; delegation_event
  0—1 Escalation (chain attached per FR-ORC-06)
- model_provider 1—N model_catalog_entry; model_route 1—N model_route_version
  (chain references model_provider + model_catalog_entry); AgentDefinition (version)
  N—1 model_route_version (pinned); model_route_version 1—N model_usage_event
- mcp_manifest_item (kind=resource) 0—1 knowledge_source (as an ingestion candidate,
  FR-MCP-20/FR-KB-02)
- ToolCall N—1 AgentDefinition (version) where the "tool" is a registered specialist
  agent (Module E agent-as-tool, FR-ORC-01) — reuses the existing ToolCall entity
  rather than a parallel one

### 6.3 ER Diagram (text form)

```
Tenant ──1:N── User ──N:M── Role
  │
  ├──1:N── Channel
  │
  ├──1:N── Connector ──1:N── Tool ──N:1── CapabilityGroup
  │
  ├──1:N── Conversation ──1:N── Message
  │             │
  │             ├──1:N── ToolCall ──N:1── Tool
  │             │             └──0:1── A2ATask
  │             │
  │             └──0:N── Escalation
  │
  ├──1:N── AgentDefinition ──1:N── Deployment
  │
  ├──1:N── Credential
  ├──1:N── AuditLogEntry
  └──1:N── TrustedAgent ──1:N── A2ATask
```

### 6.4 ER Diagram Extension — Blueprint Modules A–F (text form)

This diagram is additive to §6.3; entities here connect into the core diagram at
`Tenant`, `Connector`/`Tool`, `AgentDefinition`, `Conversation`, and `Escalation`, as
detailed in §6.2's "Blueprint-derived relationships."

```
Tenant
  │
  ├──1:N── mcp_server ──1:N── mcp_server_version ──1:N── mcp_environment_binding
  │             │                      └──1:N── mcp_manifest_item ──0:1── knowledge_source
  │             └──1:N── mcp_drift_event
  │
  ├──1:N── knowledge_collection ──1:N── knowledge_source
  │                    └──1:N── knowledge_index_generation ──1:N── knowledge_chunk
  │                                          ├──1:N── graph_entity ──N:1── graph_community
  │                                          └──1:N── graph_edge ──N:1── knowledge_chunk (provenance)
  │
  ├──1:N── skill ──1:N── skill_version ──N:M── AgentDefinition (pinned by version)
  │
  ├──1:N── workflow ──1:N── workflow_version ──1:N── workflow_run ──1:N── workflow_run_step
  │                              └──N:M── AgentDefinition / skill_version (node refs)
  │
  ├──1:N── team ──1:N── team_version ──1:N── team_member ──N:1── AgentDefinition
  │
  ├──1:N── model_provider ──1:N── model_catalog_entry
  ├──1:N── model_route ──1:N── model_route_version ──1:N── model_usage_event
  │
  └── Conversation ──1:N── retrieval_event
             ├──1:N── delegation_event ──0:1── Escalation (chain attached)
             └──1:N── ToolCall (may target a registered specialist AgentDefinition, Module E)
```

---

## 7. MVP Scope vs. Future Roadmap

### 7.1 MVP (ships first — corresponds to screen inventory's 🔵 launch-critical items)

- Widget (Portal A) — full A.1/A.2 message-type set, embed config, language selection,
  RTL/i18n, voice mode.
- Admin Console core (Portal B): Dashboard, Channel management (Web Widget, Meta
  family, Voice/IVR, routing rules), full MCP connector framework (B.3 + B.3A in
  full — this is the core differentiator and cannot be deferred), Conversation
  management/trace viewer, Escalation management, core Reporting (channel
  performance, tool call analytics, goal coverage, AI cost), Settings/Security (users/
  roles, audit log, environments, data residency, credential vault), PII policy, Auth/
  MFA, and the full Agent Platform Architecture Console (B.15) — since Agent
  Definition Registry, Deployment/Canary, Eval Suite, Model Gateway, and Observability
  are foundational to running any agent safely, not a later enhancement.
- Conversation Designer Studio (Portal C) — capability/tool catalog, dialogue flow
  designer, parameter validation, guardrails, knowledge base config.
- Human Agent Bridge (Portal D) — escalation queue, live takeover panel.
- Developer Portal (Portal E) — getting started, MCP connector guide, API reference,
  sandbox test console.

### 7.2 Post-MVP / Fast-follow (🟡 in the inventory, high value but not launch-blocking)

- Proactive nudge bubble (widget).
- Satisfaction survey card.
- A2A management (agent card editor, trusted agents, task monitor) — full A2A
  interoperability is valuable but not required for a tenant to get value from MCP-
  based orchestration alone.
- SLA compliance report, A2A task report.
- Gateway Agent management (on-prem tunneling) — needed only once a tenant has
  on-prem/stdio backends; cloud-only tenants don't need it at launch.
- Agent Performance Dashboard (Human Agent Bridge).
- Code-First Agent Builder (B.15.2) — the visual Dialogue Flow Designer plus direct
  YAML editing cover MVP authoring needs; the chat-driven builder is a productivity
  enhancement layered on the same underlying artifact.

### 7.3 Resolved Product Decisions (formerly "decision required" in source material)

- **Campaign Manager (Portal B.9 — broadcast messaging).** **Decision: build fresh,
  post-launch.** Not part of MVP; scheduled as a Phase 5 / P2 backlog item, built new
  against the current architecture (no existing implementation is being ported).
- **Growth Tools (Portal B.10 — social auto-reply on Facebook/Instagram comments).**
  **Decision: deprecated.** Dropped from scope entirely — not MVP, not roadmap. The
  platform focuses on the omnichannel conversational core rather than social-engagement
  automation. Portal B.10 (B.10.1, B.10.2) is removed from the backlog.

### 7.4 Blueprint-Derived Enhancement Roadmap (2026-08-28)

The MVP described in §7.1–7.3 has already shipped and is in production (per
`docs/NEXUS_STATE.md`'s decision log). The six Blueprint modules (§4.14–4.17 and the
extensions to §4.3/4.10/4.11) are a **second wave of scope**, sequenced by the
Blueprint's own dependency/risk analysis (Blueprint §13), which this specification
adopts verbatim rather than re-deriving a different order. `docs/BACKLOG.md` encodes
this as Phases 6–10 (continuing the existing Phase 1–5 numbering).

| Wave phase | Contents | Priority | Non-negotiable ordering |
|---|---|---|---|
| **6** (Blueprint Phase 0) | Emergency rollback (FR-AGT-30); capability-group management screen (FR-MCP-17); manifest pinning + drift quarantine (FR-MCP-18); injection guardrail on tool results (FR-SEC-09, injection-detection clause); structural YAML diff without Git (FR-AGT-19) | P0 | None between these five — each stands alone and closes a currently-live severity-1/2 gap (G-02, G-06, G-03, G-04, G-07) |
| **7** (Blueprint Phase 1) | Model Gateway v2 (FR-AGT-20–27); MCP enrolment wizard/registry (FR-MCP-16/19/20/21); Skills library (FR-AGT-11/12); SSO/SCIM (FR-SEC-10, NFR-17) | P0 for Model Gateway v2, MCP registry, and Skills library (each is a hard prerequisite for later work); P1 for SSO/SCIM (enterprise-procurement gate, not a technical blocker for other modules) | Model Gateway v2 must ship before Module B (embedding-model pinning, FR-KB-03/FR-AGT-27) |
| **8** (Blueprint Phase 2) | Knowledge and Graph RAG (FR-KB-02–09); Agent Design Studio + blueprints gallery (FR-AGT-13–15); permission-intersection evaluator + delegation trace tree (FR-ORC-02/08, FR-SEC-08); escalation SLA/assignment/presence/CSAT (FR-ESC-05) | P0 for the permission-intersection evaluator + trace tree (hard prerequisite for Module E); P1 for Knowledge/RAG, the Studio, and escalation workforce mechanics | The permission-intersection evaluator and trace tree must ship before the first Module E delegation runs in production (§13 closing box) — even though Module E itself ships in Phase 9 |
| **9** (Blueprint Phase 3) | Agent-as-tool registration + supervisor/specialist teams (FR-ORC-01/03–07/09–11); Workflow Designer + durable runtime (FR-WF-01–07); eval harvesting/judge grading/continuous runs (FR-AGT-16–18) | P1 | Depends on Phase 8's permission-intersection evaluator and trace tree (hard gate, not merely recommended); Workflow Designer depends on Skills (Phase 7) |
| **10** (Blueprint Phase 4) | Progressive rollout/shadow evaluation/canary (extends FR-AGT-04/05); public API/webhooks/OTel/SIEM export (FR-API-01/02, FR-ADM-10); channel expansion + cross-channel identity (FR-OC-08) | P2 | Progressive rollout depends on Phase 6's emergency rollback and Phase 8's trace tree existing first |

Rationale for treating Phase 6 as P0 despite the platform already being in production:
each of its five items closes a gap the Blueprint's own severity rating (§4, G-02/03/
04/06/07) classifies as "an incident is likely and recovery is currently slow or
impossible" (severity 1) or "a capability the platform is expected to have is absent"
(severity 2) — these are live risks in the shipped product, not speculative future
requirements, and each is independently shippable with no dependency on the other four
or on any later-phase module.

- **AI resolution rate** (FR-RP-04): % of conversations resolved without human
  escalation — target ≥ 60% within 3 months of a tenant's launch, trending toward 75%+
  as tool coverage matures.
- **Time-to-integrate a new backend**: median time from "Add Connector" start to
  production-activated tools, target < 1 business day for a pre-built template, < 1
  week for a fully custom MCP server.
- **Tool call success rate** (FR-RP-02): ≥ 98% platform-wide (excluding backend-side
  outages).
- **Escalation SLA**: median wait-time-to-pickup for human escalations < 2 minutes
  during business hours.
- **Cost efficiency** (FR-RP-07): cost per resolved conversation trending down
  quarter-over-quarter as caching/model-routing optimizations land.
- **Approval-flow safety**: zero unauthorized (un-permissioned or wrong-tier) tool
  executions in audit review — a hard trust/safety metric, not an optimization target.
- **Platform adoption**: number of tenants with ≥ 1 production connector and ≥ 1
  production channel live, tracked monthly.
- **Deployment safety**: zero production incidents traced to an agent version that
  had not passed its bound eval suite (FR-AGT-01/06 gate integrity).

**Blueprint-module metrics (added 2026-08-28):**

- **Recovery time**: median time from "incident detected" to "traffic repointed to a
  known-good version" via emergency rollback (FR-AGT-30) — target < 5 minutes
  human-decision time plus the <5s repoint bound (NFR-13); zero incidents where
  recovery took longer than the original deploy.
- **Manifest drift MTTR**: median time from a drift event being detected (FR-MCP-18)
  to human review/resolution — target < 1 business day; zero silent drift incidents
  (a schema change reaching production agent behavior without quarantine).
- **Groundedness rate**: % of knowledge-scoped agent answers with ≥ `minCitations`
  structured citations (FR-KB-06) — target ≥ 95%, tracked as a retrieval-quality
  headline metric alongside citation precision.
- **Content coverage gap closure**: reduction quarter-over-quarter in production
  questions retrieving nothing above threshold (FR-KB-08 coverage report).
- **Multi-agent cost delta**: cost-per-resolved-conversation for team-handled
  conversations vs. single-agent conversations — tracked explicitly since the
  Blueprint names multi-agent cost runaway as a named risk (§14.1); target delta
  bounded and trending down as per-role routing (FR-AGT-23) matures.
- **Delegation routing accuracy**: % of supervisor delegations to the correct
  specialist on the first hop (no routing-thrash escalation, FR-ORC-07), tracked from
  the delegation trace tree (FR-ORC-08).
- **Enterprise procurement unblocked**: SSO/SCIM (FR-SEC-10) adoption rate among
  Enterprise-tier tenants, tracked as a direct measure of whether gap G-12 is actually
  closing deals, not just shipped.

---

## 9. Constraints & Assumptions

### 9.1 Deployment Model

Per `docs/NEXUS_STATE.md`: **SaaS, Multi-Tenant.** All tenants share the platform's
control/gateway/observability planes; tenant isolation for data and agent-run
execution is a hard requirement (NFR-4) but the specific isolation mechanism (schema-
per-tenant vs. row-level security vs. per-tier logical database) is left as a
**configurable architectural decision** for the Architecture phase to resolve and
record as an ADR — it is not fixed by this specification.

### 9.2 Technical Stack (hard constraint, carried forward to Architecture)

- **Frontend:** Next.js — for the Widget, Admin Console, Conversation Designer
  Studio, Human Agent Bridge, and Developer Portal (all five portals are web
  applications; the Widget additionally ships an embeddable script/SDK build target).
- **Agent orchestration / AI core:** Google ADK (Agent Development Kit), TypeScript.
  Note: the screen inventory's own engineering appendix discusses LangGraph/Pydantic
  AI/ADK as *pluggable* per-agent orchestration graph options (`spec.graph` field,
  Python-oriented examples) — this reflects the source material's original technology
  framing. The user-specified target stack for this build is **Google ADK
  TypeScript**, which architecture must treat as the concrete choice for the MVP
  Agent Runtime, while preserving the pluggable-graph *design principle* (FR-AGT-01's
  `graph_type` field, NFR-12 extensibility) so alternative orchestration frameworks
  could be added later without a platform rewrite.

### 9.3 Assumptions

- Tenants bring their own backend systems; NextBot does not ship pre-built backend
  systems (a Zendesk template still requires the tenant to have a Zendesk instance).
- Tenants are responsible for obtaining any third-party channel credentials/approvals
  (e.g., Meta Business Manager verification, WhatsApp template approval) — NextBot
  facilitates but does not guarantee third-party approval timelines.
- Model provider availability/pricing is subject to the providers named in the Model
  Gateway fallback chain (e.g., Anthropic, OpenAI, Gemini) and may change over time;
  the Model Gateway abstraction (FR-AGT-07/08) exists specifically to absorb this
  volatility.
- The Human Agent Bridge deliberately does not replace a tenant's existing agent
  desktop/helpdesk UI — it is a context/handoff layer alongside it.

### 9.4 Resolved Questions

1. **Campaign Manager (broadcast messaging, §7.3):** ~~carry forward vs. build fresh vs.
   defer~~ — **Resolved by user 2026-08-15: build fresh, post-launch (Phase 5, P2).**
2. **Growth Tools (social auto-reply, §7.3):** ~~carry forward vs. deprecate~~ —
   **Resolved by user 2026-08-15: deprecated, dropped from scope entirely.**
3. **Multi-tenant isolation mechanism (NFR-4):** resolved by the Architecture phase —
   shared schema + PostgreSQL row-level security (ADR-0001), with a dedicated-database
   escape hatch for Enterprise-tier tenants (NFR-4a).
4. **Tenant plan/quota tiers (NFR-4a):** ~~no tier model existed~~ — **Resolved by user
   2026-08-15:** Starter/Growth/Enterprise tiers adopted with the concrete quota
   defaults in NFR-4a.
5. **Agent Definition Git hosting model (FR-AGT-02/03):** ~~platform-internal vs.
   tenant-owned remote~~ — **Resolved by user 2026-08-15: tenant-owned Git remote**
   (GitHub/GitLab) — each tenant connects its own repository; NextBot stores the
   connection (OAuth token via credential vault, FR-SEC-02) and reads/writes agent
   definition versions as commits/PRs against it. Architecture to detail the
   integration (auth flow, webhook vs. polling, residency treatment of the token) as
   an ADR amendment.
6. **X/Twitter channel (§4.1 FR-OC-02):** ~~keep vs. drop~~ — **Resolved by user
   2026-08-15: dropped from scope.** Removed from the channel enum and all channel
   lists throughout this document.

### 9.5 Blueprint-Derived Constraints, Invariants, and Open Questions (added 2026-08-28)

**Architectural invariants the new FRs (§4.14–4.17 and the MCP/AGT/KB extensions) must
satisfy — carried forward from Blueprint §3.2 as binding constraints, not new
requirements to design:**

1. **Fail closed.** New screens, new workflow node types, and new team-delegation
   paths default to no access / no capability until explicitly granted — never
   default-visible or default-permitted.
2. **Immutable versions.** Skills, model routes, workflow versions, team versions, and
   MCP server versions are all immutable once created/promoted, referenced only by
   pinned version — never by mutable name.
3. **The promotion gate applies unchanged.** Workflows, teams, and Studio-authored
   agent versions all pass through the *same* eval-gate + reviewer-not-author +
   sandbox-conversation gate already governing agent versions — none may bypass it or
   get a lighter-weight equivalent.
4. **Tool tiering survives everywhere.** A Tier-3 tool invoked from a workflow node,
   a delegated specialist, or a skill still stops at the existing Approval Queue.
5. **Credentials never returned.** Model-provider and MCP-registry credentials use the
   same encrypted vault (FR-SEC-02) as today's connector credentials — no new secret
   store.
6. **One widget artifact.** Team and workflow sandbox testing reuse the existing
   single widget artifact (FR-OC-01) — no lighter-weight mock sandbox is introduced.
7. **Separate audit trails.** Multi-agent delegation extends tenant audit attribution
   to a full delegation chain (FR-ORC-08); it does not merge tenant and platform audit
   trails, which remain separate per the existing Platform Manager invariant.

**Decisions the existing spec/ADRs already settle (not re-opened):**

- Multi-tenant isolation mechanism (shared-schema RLS + Enterprise dedicated-DB escape
  hatch, ADR-0001/NFR-4a) applies unchanged to all new Blueprint entities (§6.1a) —
  they are ordinary tenant-scoped tables under the same isolation strategy, with the
  exception of platform-shared model providers and (possibly) platform-shared skills,
  see below.

**Decisions the user resolved directly (2026-08-28), no longer open — `nexus-architect`
must design against these, not re-raise them:**

1. **Graph store**: a **dedicated graph database** (not graph tables + the existing
   vector index). `nexus-architect` must select a specific product, define its
   multi-tenant isolation strategy (this is a new datastore the platform's existing
   RLS-based isolation, ADR-0001, does not automatically cover), and record both as an
   ADR. `graph_entity`/`graph_edge`/`graph_community` (§6.1a) keep their specified
   logical shape; only the physical store changes from what a tables-only approach
   would have used.
2. **Teams vs. workflows**: **two separate artifacts**, per the Blueprint's original
   proposal (`team`/`team_version` and `workflow`/`workflow_version` remain distinct,
   §6.1a) — their governance genuinely differs (static/reviewable vs. dynamic
   delegation) and each keeps its own single-purpose promotion-gate/permission story.
3. **Skill tenant-scoping**: **tenant-scoped only** for this build. `skill.tenant_id`
   is NOT nullable — every skill belongs to exactly one tenant, same isolation model as
   every other tenant-scoped entity (ADR-0001). No platform-shared skill/blueprint
   library ships in this phase; FR-AGT-15's "blueprints gallery" is deferred/descoped
   accordingly unless a future phase deliberately designs the cross-tenant sharing
   question this would otherwise require.
4. **Team routing visibility**: **internal-only**. A supervisor's delegation decision
   is visible in the takeover panel, Runtime Traces, and the audit log (FR-ORC-06/08
   as already specified) but is NEVER surfaced in the customer-facing transcript or
   widget — the multi-agent structure stays an implementation detail to the customer,
   consistent with the existing "one faithful widget artifact" invariant.

**Still open, deliberately deferred (not architecture-blocking, revisit later):**

5. **Knowledge indexing of conversation history**: see FR-KB-09 — still unresolved;
   interacts with retention, DSR deletion, and PII masking. Does not block Model
   Gateway v2, MCP Registry, or the Skills/Studio/Workflow/Team architecture, so
   `nexus-architect` should design the knowledge subsystem to make this addable later
   without a breaking change, rather than deciding it now.
6. **Plan-tier governance of provider types**: FR-AGT-26 states the *mechanism*
   (Platform Manager governs provider types per tier) but not the *policy* (which
   types are allowed at which tier) — a product/commercial decision, left for later.

**Decisions this specification recorded as ADR-worthy for `nexus-architect` (so the
next phase does not have to re-derive the list) — each corresponds to a Blueprint
"non-negotiable" or structurally load-bearing design move:**

- The three-layer Provider/Model-catalog/Route model replacing the free-text model
  string (FR-AGT-20–22), including the provider-type→adapter mapping (§11.3) and
  capability-intersection-at-save-time validation rule.
- Agent-as-tool delegation (FR-ORC-01): registering a specialist agent version as a
  Tool Catalog entry rather than building a parallel invocation/permission/audit
  system — and the centralized permission-intersection evaluator this requires
  (FR-ORC-02/FR-SEC-08).
- Workflow-as-YAML through the existing promotion gate (FR-WF-01/02) — the graph
  canvas as a renderer over one validated YAML document, with no separate promotion
  path.
- MCP manifest pinning and drift-as-new-item-not-update semantics (FR-MCP-18) — the
  specific mechanism by which a compromised/updated server cannot silently escalate
  privilege.
- Skill versioning and the "upgrade consumers" pattern (FR-AGT-11/12) — how a shared,
  reusable artifact stays consistent with agent-version immutability.
- Structural YAML diff as a Git-independent baseline capability (FR-AGT-19), with Git
  diff (ADR-0009) retained as an enriched, optional view.
- Emergency rollback as a deliberate, audited promotion-gate bypass limited to
  previously-Production versions only (FR-AGT-30) — the precise boundary of what is
  and is not a "weakening" of the gate.
- Knowledge subsystem embedding-model pinning per index generation (FR-KB-03) and its
  hard ordering dependency on Model Gateway v2 shipping first.
